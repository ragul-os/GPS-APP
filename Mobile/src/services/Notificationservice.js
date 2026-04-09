/**
 * src/services/notificationService.js
 * Place at: src/services/notificationService.js
 */

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { SERVER_URL } from '../config';

// Show banner even when app is open/foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge:  true,
  }),
});

export async function registerForPushNotifications() {
  if (!Device.isDevice) {
    console.warn('⚠️ Push only works on real device');
    return null;
  }

  // Android: create high-priority channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('ambulance-alerts', {
      name:             'Ambulance Alerts',
      importance:       Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor:       '#E53935',
      sound:            'default',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd:        true,
    });
    console.log('📳 Android channel: ambulance-alerts created');
  }

  // Request permission
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    console.warn('❌ Permission denied');
    return null;
  }

  // Get push token
  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    console.log('🎫 Expo Push Token:', token);

    // Send token to server
    const res  = await fetch(`${SERVER_URL}/register-token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token }),
    });
    const json = await res.json();
    console.log(`✅ Registered — server has ${json.devices} device(s)`);
    return token;
  } catch (err) {
    console.error('❌ Token error:', err.message);
    return null;
  }
}