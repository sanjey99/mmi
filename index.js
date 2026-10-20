// Capture account links before the router or authentication SDK can read the URL.
require('./src/features/auth/emailActionBootstrap');
require('./src/features/operations/bootstrap');
require('expo-router/entry');
