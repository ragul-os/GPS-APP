/**
 * app/_layout.tsx
 *
 * Root layout. Wraps everything in AuthProvider.
 * AuthGuard redirects based on session state.
 * NO NavigationContainer needed — Expo Router provides it.
 */

import { Slot, router, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { AuthProvider, useAuth } from '../src/context/AuthContext';

function AuthGuard() {
  const auth = useAuth();
  const { session, loading } = auth!;
  const segments = useSegments();
  const firstSegment = segments[0] as string | undefined;

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = firstSegment === '(auth)';
    const inAppGroup  = firstSegment === '(app)';

    if (!session && !inAuthGroup) {
      router.replace('/(auth)/login' as any);
    } else if (session && inAuthGroup) {
      // After login go to the alert screen (not tabs directly)
      router.replace('/(app)/alert' as any);
    }
  }, [session, loading, firstSegment]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#060910', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 40, marginBottom: 16 }}>🚨</Text>
        <ActivityIndicator size="large" color="#ef4444" />
        <Text style={{ color: '#475569', marginTop: 12, fontSize: 13, letterSpacing: 1 }}>
          LOADING...
        </Text>
      </View>
    );
  }

  return <Slot />;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <AuthGuard />
    </AuthProvider>
  );
}