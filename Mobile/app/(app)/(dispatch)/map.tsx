/**
 * app/(app)/(dispatch)/map.tsx
 *
 * Wraps MapScreen. Receives all dispatch params via Expo Router search params.
 * We convert them back into the format MapScreen expects (via route.params).
 *
 * FIX: roomId is now correctly extracted and passed through.
 */
import { router, useLocalSearchParams } from 'expo-router';
import MapScreen from '../../../src/screens/MapScreen';

export default function MapTab() {
  const params = useLocalSearchParams<{
    destination:       string;
    patientName:       string;
    patientPhone:      string;
    address:           string;
    notes:             string;
    ambulanceId:       string;
    matrixToken:       string;
    roomId:            string;
    initialTripStatus: string;
  }>();

  console.log('[MapTab] params received:', JSON.stringify(params));
  console.log('[MapTab] roomId from params:', params.roomId);

  // MapScreen expects route.params.destination as a parsed object
  const parsedDestination = params.destination
    ? JSON.parse(params.destination)
    : { latitude: 11.0168, longitude: 76.9558 };

  // Shim so MapScreen's navRoute.params pattern still works unchanged
  const shimRoute = {
    params: {
      destination:       parsedDestination,
      patientName:       params.patientName       || '',
      patientPhone:      params.patientPhone       || '',
      address:           params.address            || '',
      notes:             params.notes              || '',
      ambulanceId:       params.ambulanceId        || '',
      matrixToken:       params.matrixToken        || '',
      roomId:            params.roomId             || '',   // ← critical
      initialTripStatus: params.initialTripStatus  || 'accepted',
    },
  };

  console.log('[MapTab] shimRoute.params.roomId:', shimRoute.params.roomId);

  // MapScreen uses navigation.navigate('Alert') to go back —
  // shim it to use Expo Router navigation
  const shimNavigation = {
    navigate: (screen: string) => {
      console.log('[MapTab] navigation.navigate called with screen:', screen);
      if (screen === 'Alert') {
        router.replace('/(app)/alert' as any);
      }
    },
  };

  return <MapScreen route={shimRoute} navigation={shimNavigation} />;
}