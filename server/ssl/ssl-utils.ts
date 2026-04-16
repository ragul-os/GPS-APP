import fs from 'fs';
import path from 'path';
import https from 'https';
import tls from 'tls';
import crypto from 'crypto';
import logger from './logger';

export interface SSLOptions {
    ca?: Buffer[];
    rejectUnauthorized: boolean;
    checkServerIdentity?: (host: string, cert: any) => Error | undefined;
}

let loadedCAs: Buffer[] = [];
let loadedX509CAs: crypto.X509Certificate[] = [];
let loadedLeafFingerprints: Set<string> = new Set();
let isTrustStoreLoaded = false;

const loadTrustStore = () => {
    if (isTrustStoreLoaded) return;
    const envPath = process.env.TRUST_STORE_PATH?.replace(/['"]/g, '').trim();
    const trustDir = envPath
        ? path.resolve(process.cwd(), envPath)
        : path.resolve(process.cwd(), 'trust-store');

    if (!fs.existsSync(trustDir)) {
        logger.warn(`[SSL] Trust store directory not found at: ${trustDir}`);
        isTrustStoreLoaded = true;
        return;
    }

    const files = fs.readdirSync(trustDir);
    for (const file of files) {
        const fullPath = path.join(trustDir, file);
        try {
            const certBuffer = fs.readFileSync(fullPath);
            // Try to parse it to ensure it's a valid certificate
            const x509 = new crypto.X509Certificate(certBuffer);

            if (x509.ca) {
                loadedCAs.push(certBuffer);
                loadedX509CAs.push(x509);
                logger.info(`[SSL] Trust Store -> Loaded Root CA: ${file}`);
            } else {
                // It's a leaf cert. We extract its fingerprint.
                const fingerprint = x509.fingerprint256.replace(/:/g, '').toUpperCase();
                loadedLeafFingerprints.add(fingerprint);
                logger.info(
                    `[SSL] Trust Store -> Loaded Trusted Leaf: ${file} (Fingerprint: ${fingerprint.substring(0, 16)}...)`,
                );
            }
        } catch (e) {
            logger.warn(
                `[SSL] Trust Store -> Failed to load certificate ${file}: ${(e as Error).message}`,
            );
        }
    }

    isTrustStoreLoaded = true;
};

/**
 * Loads SSL options from environment variables and the central trust-store folder.
 *
 * Supports two modes automatically:
 *  - Root CA mode: uses all CA certs found in the trust-store folder.
 *  - Trusted Leaf mode: any leaf cert found in trust-store is trusted by exact verification of its fingerprint.
 *
 * @param prefix Prefix for environment variables (e.g., 'OPENSEARCH' or 'AES')
 */
export const getSSLOptions = (prefix: string): SSLOptions => {
    const rejectUnauthorizedString = process.env[
        `${prefix}_SSL_REJECT_UNAUTHORIZED`
    ]
        ?.replace(/['"]/g, '')
        .trim();
    const checkHostnameString = process.env[`${prefix}_SSL_CHECK_HOSTNAME`]
        ?.replace(/['"]/g, '')
        .trim();

    const rejectUnauthorized = rejectUnauthorizedString === 'true';
    const checkHostname = checkHostnameString === 'true';

    // Load the trust store into memory (only happens once)
    loadTrustStore();

    if (!rejectUnauthorized) {
        // Insecure mode requested
        logger.info(
            `[SSL] ${prefix} config -> Mode: Insecure Standard (rejectUnauthorized: false), checkHostname: ${checkHostname}`,
        );
        return {
            ca: loadedCAs.length > 0 ? loadedCAs : undefined,
            rejectUnauthorized: false,
            checkServerIdentity: checkHostname ? undefined : () => undefined,
        };
    }

    // Secure mode requested (rejectUnauthorized = true)
    const hasLeafCerts = loadedLeafFingerprints.size > 0;
    const hasCACerts = loadedCAs.length > 0;

    const checkServerIdentity = (
        host: string,
        peerCert: any,
    ): Error | undefined => {
        // 1. Optional hostname check
        if (checkHostname) {
            const err = tls.checkServerIdentity(host, peerCert);
            if (err) return err;
        }

        // 2. Trusted leaf cert comparison
        if (hasLeafCerts && peerCert && peerCert.fingerprint256) {
            const serverFingerprint = peerCert.fingerprint256
                .replace(/:/g, '')
                .toUpperCase();
            if (loadedLeafFingerprints.has(serverFingerprint)) {
                logger.info(
                    `[SSL] ${prefix} -> ✅ Trusted leaf certificate verified successfully by fingerprint.`,
                );
                return undefined; // Match found, successful connection!
            }
        }

        // 3. CA Signature Chain Verification (Unified custom engine)
        // Walk the entire certificate chain presented by the server to see if any node
        // is cryptographically signed by one of our trusted Root CAs.
        if (hasCACerts && peerCert) {
            let currentNode = peerCert;
            while (currentNode && currentNode.raw) {
                try {
                    const currentX509 = new crypto.X509Certificate(currentNode.raw);
                    // Check against all loaded Root CAs
                    for (const caX509 of loadedX509CAs) {
                        if (
                            currentX509.checkIssued(caX509) &&
                            currentX509.verify(caX509.publicKey)
                        ) {
                            logger.info(
                                `[SSL] ${prefix} -> ✅ Certificate chain verified successfully by Root CA.`,
                            );
                            return undefined; // Chain leads to trusted Root CA!
                        }
                    }
                } catch (e) {
                    // Ignore parsing errors for individual nodes and let the loop continue
                }

                // Traverse up the chain
                if (
                    currentNode.issuerCertificate &&
                    currentNode.issuerCertificate !== currentNode
                ) {
                    currentNode = currentNode.issuerCertificate;
                } else {
                    break; // Reached the top of the presented chain
                }
            }
        }

        // 4. Rejection logic if both checks failed
        if (!hasCACerts) {
            logger.error(
                `[SSL] ${prefix} -> CERT REJECTED: Certificate not in Trusted Leaves and no Root CAs loaded.`,
            );
        } else {
            logger.error(
                `[SSL] ${prefix} -> CERT REJECTED: Certificate not in Trusted Leaves and failed Root CA signature check.`,
            );
        }

        return new Error(
            `[SSL] ${prefix} -> Certificate is unauthorized. Connection rejected.`,
        );
    };

    logger.info(
        `[SSL] ${prefix} config -> Mode: Secure Trust Store (${loadedCAs.length} CAs, ${loadedLeafFingerprints.size} Leaves), checkHostname: ${checkHostname}`,
    );

    return {
        ca: hasCACerts ? loadedCAs : undefined,
        // By default, if secure mode is requested, we want Node.js to reject unauthorized connections natively.
        // The ONLY exception is if we have Trusted Leaf certificates loaded. Since Node.js native engine
        // unconditionally blocks leaf certs not signed by CAs, we must set rejectUnauthorized: false
        // to bypass the native block, and strictly manually enforce security inside `checkServerIdentity`.
        rejectUnauthorized: hasLeafCerts ? false : true,
        checkServerIdentity,
    };
};

/**
 * Creates an https.Agent using the provided SSL options.
 */
export const createHttpsAgent = (prefix: string): https.Agent => {
    const options = getSSLOptions(prefix);
    return new https.Agent(options);
};
