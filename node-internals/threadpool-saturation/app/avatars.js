'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Generates a fixed set of mock "avatar" files on disk the first time this
// module loads — standing in for user-uploaded profile photos that would
// already exist in a real deployment (local disk, an EBS volume, etc).
// Both the broken app and the solution import this, so they read from the
// same fixtures. Delete the `avatars/` folder to regenerate.

const AVATAR_DIR = path.join(__dirname, 'avatars');
const AVATAR_COUNT = 20;
const AVATAR_SIZE_BYTES = 150 * 1024; // ~150KB — roughly a small profile photo

if (!fs.existsSync(AVATAR_DIR)) {
  fs.mkdirSync(AVATAR_DIR);
  for (let i = 1; i <= AVATAR_COUNT; i++) {
    fs.writeFileSync(path.join(AVATAR_DIR, `${i}.bin`), crypto.randomBytes(AVATAR_SIZE_BYTES));
  }
}

module.exports = { AVATAR_DIR, AVATAR_COUNT };
