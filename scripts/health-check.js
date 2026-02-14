// Health check script for Werewolf bot
// Usage: node scripts/health-check.js

const fs = require('fs');
const path = require('path');

console.log('🔍 Werewolf Bot - Health Check\n');

let issuesFound = 0;

// Check 1: Environment variables
console.log('✓ Checking environment...');
const requiredVars = ['TOKEN', 'CLIENT_ID'];
if (fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf-8');
  requiredVars.forEach(varName => {
    if (!envContent.includes(varName)) {
      console.log(`  ❌ Missing ${varName} in .env`);
      issuesFound++;
    }
  });
  if (issuesFound === 0) {
    console.log('  ✅ All environment variables present (.env)');
  }
} else {
  // In CI or Docker, env vars may be set directly
  const missing = requiredVars.filter(v => !process.env[v]);
  if (missing.length > 0) {
    console.log('  ❌ .env file not found and missing env vars: ' + missing.join(', '));
    issuesFound++;
  } else {
    console.log('  ✅ All environment variables present (env)');
  }
}

// Check 2: Audio files
console.log('\n✓ Checking audio files...');
const requiredAudio = [
  'night_ambience.mp3',
  'day_ambience.mp3',
  'death.mp3',
  'victory_villagers.mp3',
  'victory_wolves.mp3'
];
const audioDir = path.join(__dirname, '..', 'audio');
if (!fs.existsSync(audioDir)) {
  console.log('  ❌ audio/ directory not found');
  issuesFound++;
} else {
  requiredAudio.forEach(file => {
    const filePath = path.join(audioDir, file);
    if (!fs.existsSync(filePath)) {
      console.log(`  ⚠️ Missing audio file: ${file}`);
    }
  });
  console.log('  ✅ Audio directory exists');
}

// Check 3: Data directory
console.log('\n✓ Checking data directory...');
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  console.log('  ⚠️ data/ directory not found (will be created on first save)');
} else {
  console.log('  ✅ Data directory exists');
  
  const gamesFile = path.join(dataDir, 'games.json');
  if (fs.existsSync(gamesFile)) {
    try {
      const content = fs.readFileSync(gamesFile, 'utf-8');
      JSON.parse(content);
      console.log('  ✅ games.json is valid JSON');
    } catch (e) {
      console.log('  ❌ games.json is corrupted');
      issuesFound++;
    }
  }
}

// Check 4: Utils files
console.log('\n✓ Checking utility files...');
const utilFiles = ['validators.js', 'commands.js', 'interaction.js'];
const utilsDir = path.join(__dirname, '..', 'utils');
if (!fs.existsSync(utilsDir)) {
  console.log('  ❌ utils/ directory not found');
  issuesFound++;
} else {
  utilFiles.forEach(file => {
    if (!fs.existsSync(path.join(utilsDir, file))) {
      console.log(`  ❌ Missing utils/${file}`);
      issuesFound++;
    }
  });
  if (issuesFound === 0) {
    console.log('  ✅ All utility files present');
  }
}

// Check 5: Commands
console.log('\n✓ Checking commands...');
const commandsDir = path.join(__dirname, '..', 'commands');
if (!fs.existsSync(commandsDir)) {
  console.log('  ❌ commands/ directory not found');
  issuesFound++;
} else {
  const commands = fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'));
  console.log(`  ✅ Found ${commands.length} command files`);
}

// Check 6: Node modules
console.log('\n✓ Checking dependencies...');
const requiredPackages = ['discord.js', 'dotenv', '@discordjs/voice', 'ffmpeg-static'];
const packageJson = require('../package.json');
requiredPackages.forEach(pkg => {
  if (!packageJson.dependencies[pkg]) {
    console.log(`  ❌ Missing dependency: ${pkg}`);
    issuesFound++;
  }
});
if (!fs.existsSync(path.join(__dirname, '..', 'node_modules'))) {
  console.log('  ❌ node_modules not found - run npm install');
  issuesFound++;
} else {
  console.log('  ✅ All dependencies installed');
}

// Summary
console.log('\n' + '='.repeat(50));
if (issuesFound === 0) {
  console.log('✅ Health check passed! Bot is ready to run.');
  console.log('\nTo start the bot: node index.js');
} else {
  console.log(`⚠️ Found ${issuesFound} issue(s) - please fix before running.`);
  process.exit(1);
}

console.log('='.repeat(50));
