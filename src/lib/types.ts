export type NameEffect = 'none' | 'glow' | 'pulse' | 'rainbow' | 'wave'
export type NameFont = 'default' | 'mono' | 'pixel' | 'script'
export type AvatarFrame = 'none' | 'ring' | 'glow' | 'rainbow' | 'cyber' | 'dashed' | 'gold'
export type CardEffect = 'none' | 'scanlines' | 'grid' | 'aurora' | 'matrix' | 'vapor'
export type Presence = 'online' | 'busy' | 'away' | 'offline'
export type Profile = {
  id: string; display_name: string; handle: string; avatar_url?: string | null
  name_color?: string | null; name_effect?: NameEffect; name_font?: NameFont
  status_text?: string; bio?: string; banner_url?: string | null
  avatar_frame?: AvatarFrame; card_effect?: CardEffect; card_color?: string | null
  presence?: Presence
}
export type Server = {
  id: string; name: string; description: string; owner_id: string
  icon_url?: string | null; name_color?: string | null; name_effect?: NameEffect; name_font?: NameFont
}
export type InvitePreview = {
  server_id: string; name: string; description: string; icon_url?: string | null
  name_color?: string | null; name_effect?: NameEffect; name_font?: NameFont
  inviter: string; inviter_avatar?: string | null; members: number
}
export type Channel = { id: string; server_id: string | null; name: string; kind: 'text' | 'voice' | 'direct'; topic: string }
export type Message = {
  id: string; channel_id: string; author_id: string; content: string; created_at: string
  attachment_path: string | null; attachment_name: string | null; attachment_type: string | null
  reply_to?: string | null; edited_at?: string | null
  author?: Profile
  reply?: { id: string; content: string; attachment_name?: string | null; author?: Profile | null } | null
}
export type Friendship = { id: string; requester_id: string; recipient_id: string; status: 'pending' | 'accepted'; peer: Profile }
export type Membership = { user_id: string; role: 'owner' | 'moderator' | 'member'; nickname?: string | null; profile: Profile }
export type RoleFlag = 'moderate_voice' | 'manage_channels' | 'manage_roles' | 'manage_invites' | 'kick_members' | 'edit_notes' | 'manage_nicknames' | 'manage_server'
export type Role = {
  id: string; server_id: string; name: string; color: string; position: number
  moderate_voice: boolean; manage_channels: boolean; manage_roles: boolean
  manage_invites: boolean; kick_members: boolean; edit_notes: boolean; manage_nicknames: boolean; manage_server: boolean
}
export type MemberRole = { user_id: string; role_id: string }
export type RoomCredentials = { token: string; url: string; channel: Channel }
