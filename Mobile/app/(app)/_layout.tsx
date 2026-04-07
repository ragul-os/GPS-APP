/**
 * app/(app)/_layout.tsx
 *
 * Protected area. Just passes through.
 * The alert screen lives directly here (no tabs yet).
 * Tabs only appear after a dispatch is accepted.
 */
import { Slot } from 'expo-router';

export default function AppLayout() {
  return <Slot />;
}