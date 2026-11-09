export type Profile = { id: string; display_name: string; handle: string; avatar_url?: string }
export type Server = { id: string; name: string; description: string; owner_id: string }
export type Channel = { id: string; server_id: string | null; name: string; kind: 'text' | 'voice' | 'direct'; topic: string }
export type Message = {
  id: string; channel_id: string; author_id: string; content: string; created_at: string
  attachment_path: string | null; attachment_name: string | null; attachment_type: string | null
  author?: Profile
}
export type Friendship = { id: string; requester_id: string; recipient_id: string; status: 'pending' | 'accepted'; peer: Profile }
export type Membership = { user_id: string; role: 'owner' | 'moderator' | 'member'; profile: Profile }
export type RoleFlag = 'moderate_voice' | 'manage_channels' | 'manage_roles' | 'manage_invites' | 'kick_members' | 'edit_notes'
export type Role = {
  id: string; server_id: string; name: string; color: string; position: number
  moderate_voice: boolean; manage_channels: boolean; manage_roles: boolean
  manage_invites: boolean; kick_members: boolean; edit_notes: boolean
}
export type MemberRole = { user_id: string; role_id: string }
export type RoomCredentials = { token: string; url: string; channel: Channel }
