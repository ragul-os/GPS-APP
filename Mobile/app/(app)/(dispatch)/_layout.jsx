import { Tabs } from 'expo-router';
import { Platform, Text } from 'react-native';
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
        tabBarInactiveTintColor: '#475569',
        tabBarLabelStyle: {
          fontSize: 11, fontWeight: '700', letterSpacing: 0.5,
        },
      }}
    >
      <Tabs.Screen
        name="map"
        options={{
          title: 'Navigation',
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: focused ? 24 : 20 }}>🗺</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Dispatch Chat',
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: focused ? 24 : 20 }}>💬</Text>
          ),
        }}
      />
    </Tabs>
  );
}