import './src/mobile-polyfills';
import { AppRegistry } from 'react-native';
import { name as appName } from './app.json';
import AuthFlowScreen from './src/auth-flow';

AppRegistry.registerComponent(appName, () => AuthFlowScreen);
