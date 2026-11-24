import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = { appId: 'com.personal.murmur', appName: 'MURMUR', webDir: 'dist', android: { backgroundColor: '#000000' }, plugins: { SplashScreen: { launchShowDuration: 0 } } };
export default config;
