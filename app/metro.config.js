// Metro, Expo's defaults plus .bin assets: the badge firmware files in
// assets/firmware ship with the app and its over-the-air updates.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('bin');

module.exports = config;
