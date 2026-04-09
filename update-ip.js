const os = require('os');
const fs = require('fs');
const path = require('path');
const dgram = require('dgram');

/**
 * Automatically detects the primary local IPv4 address.
 * Uses a UDP connection trick to find the interface used for external traffic.
 */
async function getLocalIP() {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    try {
      // We don't actually send any data, just "connect" to a public IP to see which local interface is used.
      socket.connect(53, '8.8.8.8', () => {
        const address = socket.address().address;
        socket.close();
        resolve(address);
      });
    } catch (e) {
      // Fallback if no internet or connection fails
      const interfaces = os.networkInterfaces();
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
          if (iface.family === 'IPv4' && !iface.internal) {
            resolve(iface.address);
            return;
          }
        }
      }
      resolve('localhost');
    }
    
    // Safety timeout
    setTimeout(() => {
        try { socket.close(); } catch(e) {}
        // Final fallback
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
          for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
              resolve(iface.address);
              return;
            }
          }
        }
        resolve('localhost');
    }, 1000);
  });
}

async function run() {
  const currentIP = await getLocalIP();
  console.log(`\n🚀 Detected Local IP: ${currentIP}`);

  // 1. Update Mobile/src/config.js
  const mobileConfigPath = path.join(__dirname, 'Mobile', 'src', 'config.js');
  if (fs.existsSync(mobileConfigPath)) {
    let content = fs.readFileSync(mobileConfigPath, 'utf8');
    const updatedContent = content
      .replace(/(SERVER_URL\s*=\s*['"])http:\/\/[^:]+(:5000['"])/g, `$1http://${currentIP}$2`)
      .replace(/(SYNAPSE_BASE\s*=\s*['"])http:\/\/[^:]+(:8008['"])/g, `$1http://${currentIP}$2`);
    
    if (content !== updatedContent) {
      fs.writeFileSync(mobileConfigPath, updatedContent);
      console.log(`✅ Updated Mobile Config: Mobile/src/config.js`);
    } else {
      console.log(`ℹ️  Mobile Config already up to date.`);
    }
  }

  // 2. Update client/src/config/apiConfig.js
  const webConfigPath = path.join(__dirname, 'client', 'src', 'config', 'apiConfig.js');
  if (fs.existsSync(webConfigPath)) {
    let content = fs.readFileSync(webConfigPath, 'utf8');
    const updatedContent = content
      .replace(/(import\.meta\.env\.VITE_API_BASE_URL\s*\?\?\s*['"])http:\/\/[^:]+(:5000['"])/g, `$1http://${currentIP}$2`)
      .replace(/(import\.meta\.env\.VITE_SYNAPSE_BASE_URL\s*\?\?\s*['"])http:\/\/[^:]+(:8008['"])/g, `$1http://${currentIP}$2`);

    if (content !== updatedContent) {
      fs.writeFileSync(webConfigPath, updatedContent);
      console.log(`✅ Updated Web Config: client/src/config/apiConfig.js`);
    } else {
      console.log(`ℹ️  Web Config already up to date.`);
    }
  }

  console.log(`\n✨ IP Dynamic Sync Complete!\n`);
}

run();
