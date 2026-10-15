export {};
declare global {
  interface Window {
    __APP_CONFIG__?: { supabaseUrl: string; supabaseAnonKey: string };
  }
}
