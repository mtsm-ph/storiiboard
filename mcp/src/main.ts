import { main } from './server';

// The entry point the build bundles into dist/server.js: the project files are the command line's arguments.
await main(process.argv.slice(2));
