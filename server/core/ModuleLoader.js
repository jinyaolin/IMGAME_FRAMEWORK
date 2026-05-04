'use strict';

const path = require('path');
const fs = require('fs');
const BaseModule = require('./BaseModule');

class ModuleLoader {
  constructor(modulesDir, deckManager) {
    this.modulesDir = modulesDir || path.join(__dirname, '../modules');
    this.deckManager = deckManager;
    this.registry = new Map();
    this._scanModules();
  }

  _scanModules() {
    // Clear first so deleted modules are actually removed from the registry
    this.registry.clear();
    if (!fs.existsSync(this.modulesDir)) return;
    const dirs = fs.readdirSync(this.modulesDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const name of dirs) {
      const manifestPath = path.join(this.modulesDir, name, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        this.registry.set(name, manifest);
      }
    }
    console.log(`[ModuleLoader] Found modules: ${[...this.registry.keys()].join(', ') || 'none'}`);
  }

  listModules() {
    return Array.from(this.registry.values());
  }

  getManifest(moduleId) {
    return this.registry.get(moduleId) || null;
  }

  async load(moduleName, session, hostConfig) {
    const manifest = this.registry.get(moduleName);
    if (!manifest) throw new Error(`Module "${moduleName}" not found`);

    // Engine resolution:
    //   1. manifest.engine = "<other-module-id>"  → use that module's server.js
    //   2. own dir has server.js                  → use that
    //   3. otherwise                              → use BaseModule directly
    let engineId = manifest.engine || moduleName;
    let serverPath = path.join(this.modulesDir, engineId, 'server.js');

    // Check if custom server.js exists
    if (!fs.existsSync(serverPath)) {
      // Fallback: try own dir even if engine field said otherwise (graceful degrade)
      const ownPath = path.join(this.modulesDir, moduleName, 'server.js');
      if (fs.existsSync(ownPath)) {
        serverPath = ownPath;
        engineId = moduleName;
      }
    }

    // Merge host-provided config with manifest defaults
    const config = this._resolveConfig(manifest, hostConfig);

    // Resolve deck references if DeckManager is available
    const resolvedManifest = this._resolveDecks(manifest);

    let instance;

    if (fs.existsSync(serverPath)) {
      // Use custom server.js
      console.log(`[ModuleLoader] Using custom server.js: ${serverPath}`);
      // Resolve to absolute path for require
      const absolutePath = path.resolve(serverPath);
      delete require.cache[require.resolve(absolutePath)];
      const ModuleClass = require(absolutePath);

      // Validate that ModuleClass is actually a constructor
      if (typeof ModuleClass !== 'function' || !ModuleClass.prototype) {
        console.error(`[ModuleLoader] Invalid server.js: ${serverPath} - must export a constructor/class`);
        console.error(`[ModuleLoader] Export type: ${typeof ModuleClass}`);
        console.error(`[ModuleLoader] Falling back to BaseModule`);
        instance = new BaseModule(resolvedManifest, session, config);
      } else {
        instance = new ModuleClass(resolvedManifest, session, config);
      }
    } else {
      // Use BaseModule directly (no file generation!)
      console.log(`[ModuleLoader] Using BaseModule for: ${moduleName}`);
      instance = new BaseModule(resolvedManifest, session, config);
    }

    console.log(`[ModuleLoader] Loaded module: ${moduleName} (engine: ${engineId})`);
    return instance;
  }

  // Resolve deck references to global decks
  _resolveDecks(manifest) {
    if (!this.deckManager || !manifest.decks) {
      return manifest;
    }

    const resolved = {
      ...manifest,
      decks: manifest.decks.map(deckRef => {
        // If this is a reference to a global deck
        if (deckRef.ref) {
          const globalDeck = this.deckManager.getDeck(deckRef.ref);
          if (!globalDeck) {
            throw new Error(`Deck "${deckRef.ref}" not found. Check that the deck is defined and enabled in DeckManager.`);
          }

          // Merge reference settings with global deck
          console.log(`[ModuleLoader] Resolved deck reference: ${deckRef.ref} → ${globalDeck.name}`);
          return {
            ...globalDeck,
            ...deckRef,
            id: deckRef.id || globalDeck.id, // Use local ID if specified
            cards: globalDeck.cards || [] // Always use global deck's cards
          };
        }

        // Inline decks are no longer supported — all decks must reference a global deck
        throw new Error(`Deck "${deckRef.id || deckRef.name}" has no "ref". All decks must reference a global deck.`);
      })
    };

    return resolved;
  }

  // Merge host edits on top of manifest defaults
  _resolveConfig(manifest, hostConfig) {
    // fieldValues: start from manifest defaults, override with host values
    const fieldValues = {};
    Object.entries(manifest.fieldConfig || {}).forEach(([key, def]) => {
      fieldValues[key] = def.default;
    });
    if (hostConfig?.fieldValues) Object.assign(fieldValues, hostConfig.fieldValues);

    // decks: use host-edited decks if provided, else manifest defaults
    const decks  = hostConfig?.decks  ?? manifest.decks  ?? [];

    // stages: use host-edited stages if provided, else manifest defaults
    const stages = hostConfig?.stages ?? manifest.stages ?? [];

    // Preserve any additional host config options (like voteTimeOverride)
    const config = { fieldValues, decks, stages };

    // Copy all other properties from hostConfig
    if (hostConfig) {
      Object.keys(hostConfig).forEach(key => {
        if (!config.hasOwnProperty(key)) {
          config[key] = hostConfig[key];
        }
      });
    }

    return config;
  }
}

module.exports = ModuleLoader;
