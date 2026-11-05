// For when the panel password is lost. Run it inside the bot's container.
// In production: node dist/scripts/reset-panel-password.js
// In development: node_modules/.bin/tsx src/scripts/reset-panel-password.ts
import { existsSync } from "node:fs";
import { describeNewPassword, resetAccountPassword } from "../auth/account.js";
import { config } from "../config.js";
import { openDatabase } from "../db/connection.js";

// Opening a missing database would create an empty one and print a password that does nothing.
if (!existsSync(config.databasePath)) {
  console.error(`No database at ${config.databasePath}. Run this inside the bot's container, from its working directory.`);
  process.exit(1);
}

const db = openDatabase(config.databasePath);
const password = resetAccountPassword(db, Date.now());
db.close();

console.log(describeNewPassword(password));
console.log("Every session has ended. If the login is locked after failed attempts, restart the bot or wait 15 minutes.");
