/**
 * app/(app)/(dispatch)/chat.tsx
 *
 * Uses ChatRoomListScreen so the user sees the room list first,
 * taps into a room, and can go back to the list via the back arrow.
 *
 * autoOpenRoomId: opens the alert room directly on mount (after accepting),
 * but the back arrow returns to the full room list.
 */
import {  useAuth } from '../../../src/context/AuthContext';
import ChatRoomListScreen from '../../../src/screens/Chatroomlistscreen';

export default function ChatTab() {
  const { activeRoomId } = useAuth();

  // If there's an active alert room, open it automatically AND show it in the list
  const isAlertRoom   = activeRoomId;
  const extraRoomId   = isAlertRoom ? activeRoomId : undefined;
  const autoOpenRoomId = isAlertRoom ? activeRoomId : undefined;

  return (
    <ChatRoomListScreen
      extraRoomId={extraRoomId}
      autoOpenRoomId={autoOpenRoomId}
    />
  );
}