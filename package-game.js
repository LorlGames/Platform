#!/usr/bin/env node
/**
 * package-game.js — CLI tool to package a game folder into a .lorlgame file
 * 
 * Usage:
 *   node package-game.js <game-folder> [output-name]
 * 
 * Example:
 *   node package-game.js games/sample my-game
 *   → outputs: my-game.lorlgame
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const gameFolder = process.argv[2];
const outputName = process.argv[3];

if (!gameFolder) {
  console.error('Usage: node package-game.js <game-folder> [output-name]');
  process.exit(1);
}

const absFolder = path.resolve(gameFolder);
if (!fs.existsSync(absFolder)) {
  console.error(`Folder not found: ${absFolder}`);
  process.exit(1);
}

// Check manifest
const manifestPath = path.join(absFolder, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('missing manifest.json in game folder');
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (!manifest.id || !manifest.name) {
  console.error('manifest.json must have id and name fields');
  process.exit(1);
}

// Check index.html
if (!fs.existsSync(path.join(absFolder, 'index.html'))) {
  console.error('missing index.html in game folder');
  process.exit(1);
}

const outName = outputName || manifest.id;
const outFile = path.resolve(outName + '.lorlgame');

// Use ADM-ZIP if available, else fall back to system zip
try {
  // Try to use adm-zip
  let AdmZip;
  try { AdmZip = require('adm-zip'); } catch (_) { AdmZip = null; }
  
  if (AdmZip) {
    const zip = new AdmZip();
    
    function addDir(dirPath, zipBase) {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const zipPath = zipBase ? path.join(zipBase, entry.name) : entry.name;
        if (entry.isDirectory()) {
          addDir(fullPath, zipPath);
        } else {
          zip.addLocalFile(fullPath, zipBase || '');
        }
      }
    }
    
    addDir(absFolder, '');
    zip.writeZip(outFile);
  } else {
    // Fallback: use system zip command
    const cmd = `cd "${absFolder}" && zip -r "${outFile}" .`;
    execSync(cmd);
  }
  
  const size = fs.statSync(outFile).size;
  console.log(`✓ Packaged "${manifest.name}" → ${outName}.lorlgame (${(size/1024).toFixed(1)} KB)`);
} catch (e) {
  console.error('Failed to package game:', e.message);
  process.exit(1);
}
