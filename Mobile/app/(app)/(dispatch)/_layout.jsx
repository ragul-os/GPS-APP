import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function DispatchTabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0d1117',
          borderTopColor:  '#1e263b',
          borderTopWidth:  1,
          height:          (Platform.OS === 'ios' ? 82 : 62) + insets.bottom,
          paddingBottom:   Platform.OS === 'ios' ? 22 : insets.bottom + 8,
          paddingTop:      8,
        },
        tabBarActiveTintColor:   '#ef4444',
        tabBarInactiveTintColor: '#94a3b8',
        tabBarLabelStyle: {
          fontSize: 11, fontWeight: '700', letterSpacing: 0.5,
        },
      }}
    >
      <Tabs.Screen
        name="map"
        options={{
          title: 'Navigation',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? "map" : "map-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Dispatch Chat',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? "chatbubbles" : "chatbubbles-outline"} size={22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}