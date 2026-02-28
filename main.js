'use strict';

const { Plugin, Modal, Platform, PluginSettingTab, Setting } = require('obsidian');

// ─── Display helpers ──────────────────────────────────────────────────────────

const MAC_MOD_SYMBOLS = { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' };
const WIN_MOD_LABELS  = { Mod: 'Ctrl+', Ctrl: 'Ctrl+', Alt: 'Alt+', Shift: 'Shift+', Meta: 'Win+' };
const MOD_ORDER       = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'];

function modToDisplay(mod) {
  return Platform.isMacOS ? (MAC_MOD_SYMBOLS[mod] || mod) : (WIN_MOD_LABELS[mod] || mod + '+');
}

function modsToDisplay(mods) {
  return MOD_ORDER.filter(m => mods.includes(m)).map(modToDisplay).join('');
}

function hotkeyToDisplay(hotkey) {
  const prefix = MOD_ORDER.filter(m => hotkey.modifiers.includes(m)).map(modToDisplay).join('');
  const key    = hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;
  return prefix + key;
}

// ─── Default settings ────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  delay: 400,
  showInEditor: true,
  columns: 2,
  modalWidth: 720,
};

// ─── Main plugin ─────────────────────────────────────────────────────────────

class WhichKeyPlugin extends Plugin {

  async onload() {
    await this.loadSettings();

    this.isShowingPopup   = false;
    this.modal            = null;
    this.pendingTimer     = null;
    this.pendingModifiers = [];

    this._setupKeyInterceptor();

    this.addCommand({
      id:       'show-all-bindings',
      name:     'Show all key bindings',
      callback: () => this._showPopupForModifiers([]),
    });

    this.addSettingTab(new WhichKeySettingTab(this.app, this));
    console.log('[which-key] loaded. isMacOS =', Platform.isMacOS);
  }

  onunload() {
    this._teardownKeyInterceptor();
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    console.log('[which-key] unloaded');
  }

  // ── Hotkey data ───────────────────────────────────────────────────────────

  _getAllHotkeyCommands() {
    if (this._cachedCommands) return this._cachedCommands;

    const hm       = this.app.hotkeyManager;
    const commands = this.app.commands.commands;

    const merged = Object.assign({}, hm.defaultKeys || {});
    for (const [id, hk] of Object.entries(hm.customKeys || {})) merged[id] = hk;

    const result = [];
    for (const [commandId, hotkeys] of Object.entries(merged)) {
      if (!hotkeys?.length) continue;
      const command = commands[commandId];
      if (!command) continue;
      for (const hotkey of hotkeys) {
        if (!hotkey?.modifiers || !hotkey?.key) continue;
        result.push({
          commandId,
          name:    command.name,
          key:     hotkey.key,
          hotkey,
          display: hotkeyToDisplay(hotkey),
          modStr:  [...hotkey.modifiers].sort().join('+'),
        });
      }
    }

    this._cachedCommands = result;
    return result;
  }

  _keyToObsidianMod(keyName) {
    const mac = Platform.isMacOS;
    switch (keyName) {
      case 'Meta':    return mac ? 'Mod'  : 'Meta';
      case 'Control': return mac ? 'Ctrl' : 'Mod';
      case 'Alt':     return 'Alt';
      case 'Shift':   return 'Shift';
      default:        return null;
    }
  }

  // ── Key interception ──────────────────────────────────────────────────────

  _setupKeyInterceptor() {
    const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift']);

    this._onKeyDown = (e) => {
      if (this.isShowingPopup) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.modal?._handleKey(e);
        return;
      }

      if (MODIFIER_KEYS.has(e.key)) {
        if (e.repeat) return;
        if (!this.settings.showInEditor && this._isEditorFocused()) return;

        const mod = this._keyToObsidianMod(e.key);
        if (mod && !this.pendingModifiers.includes(mod)) {
          this.pendingModifiers.push(mod);
        }
        if (!this.pendingTimer) {
          this.pendingTimer = setTimeout(() => {
            this.pendingTimer = null;
            const mods = [...this.pendingModifiers];
            this.pendingModifiers = [];
            this._showPopupForModifiers(mods);
          }, this.settings.delay);
        }
      } else {
        if (this.pendingTimer) { clearTimeout(this.pendingTimer); this.pendingTimer = null; }
        this.pendingModifiers = [];
      }
    };

    this._onKeyUp = (e) => {
      if (this.isShowingPopup) return;
      if (!MODIFIER_KEYS.has(e.key) || !this.pendingTimer) return;
      const mod = this._keyToObsidianMod(e.key);
      if (mod) this.pendingModifiers = this.pendingModifiers.filter(m => m !== mod);
      if (this.pendingModifiers.length === 0) {
        clearTimeout(this.pendingTimer);
        this.pendingTimer = null;
      }
    };

    window.addEventListener('keydown', this._onKeyDown, { capture: true });
    window.addEventListener('keyup',   this._onKeyUp,   { capture: true });
    console.log('[which-key] key interceptor active');
  }

  _teardownKeyInterceptor() {
    if (this._onKeyDown) window.removeEventListener('keydown', this._onKeyDown, { capture: true });
    if (this._onKeyUp)   window.removeEventListener('keyup',   this._onKeyUp,   { capture: true });
  }

  _isEditorFocused() {
    const view = this.app.workspace.activeLeaf?.view;
    if (!view) return false;
    try { return view.getViewType() === 'markdown' && view.getMode() === 'source'; }
    catch (_) { return false; }
  }

  // ── Popup lifecycle ───────────────────────────────────────────────────────

  _showPopupForModifiers(modifiers) {
    if (this.isShowingPopup) return;
    const allCommands = this._getAllHotkeyCommands();
    if (!allCommands.length) return;
    this.isShowingPopup = true;
    this.modal = new WhichKeyModal(this.app, this, modifiers, allCommands);
    this.modal.open();
  }

  _closePopup() {
    this.isShowingPopup  = false;
    this._cachedCommands = null;
    if (this.modal) {
      this.modal._suppressPluginReset = true;
      this.modal._forceClose();
      this.modal = null;
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
}

// ─── Modal ───────────────────────────────────────────────────────────────────

class WhichKeyModal extends Modal {
  constructor(app, plugin, initialModifiers, allCommands) {
    super(app);
    this.plugin               = plugin;
    this.allCommands          = allCommands;
    this.currentModifiers     = [...initialModifiers];
    this._suppressPluginReset = false;
    this._allowClose          = false;
  }

  close() {
    if (this._allowClose) super.close();
  }

  _forceClose() {
    this._allowClose = true;
    super.close();
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('which-key-modal');
    this._headerEl = contentEl.createEl('div', { cls: 'which-key-header' });
    this._bodyEl   = contentEl.createEl('div', { cls: 'which-key-body' });
    this._render();

    this.modalEl.addClass('wk-modal');
    this.modalEl.style.setProperty('--wk-width',   `${this.plugin.settings.modalWidth}px`);
    this.modalEl.style.setProperty('--wk-columns', this.plugin.settings.columns);

    this.containerEl.addEventListener('click', (e) => {
      if (!this.modalEl.contains(e.target)) this.plugin._closePopup();
    });
  }

  // ── Data ──────────────────────────────────────────────────────────────────

  _getViewData() {
    const currentSorted = [...this.currentModifiers].sort().join('+');

    if (this.currentModifiers.length === 0) {
      const modCounts = new Map();
      for (const cmd of this.allCommands) {
        for (const m of cmd.hotkey.modifiers) {
          modCounts.set(m, (modCounts.get(m) || 0) + 1);
        }
      }
      const subGroups = MOD_ORDER
        .filter(m => modCounts.has(m))
        .map(m => ({ mod: m, fullMods: [m], count: modCounts.get(m) }));

      const direct = this.allCommands
        .filter(cmd => cmd.modStr === '')
        .sort((a, b) => a.key.localeCompare(b.key));

      return { direct, subGroups };
    }

    const direct = this.allCommands
      .filter(cmd => cmd.modStr === currentSorted)
      .sort((a, b) => a.key.localeCompare(b.key));

    const extraModSet = new Set();
    for (const cmd of this.allCommands) {
      const cmdMods = cmd.hotkey.modifiers;
      if (!this.currentModifiers.every(m => cmdMods.includes(m))) continue;
      if (cmdMods.length <= this.currentModifiers.length) continue;
      for (const m of cmdMods) {
        if (!this.currentModifiers.includes(m)) extraModSet.add(m);
      }
    }

    const subGroups = MOD_ORDER
      .filter(m => extraModSet.has(m))
      .map(mod => {
        const fullMods = [...this.currentModifiers, mod];
        const count = this.allCommands.filter(cmd =>
          fullMods.every(m => cmd.hotkey.modifiers.includes(m))
        ).length;
        return { mod, fullMods, count };
      });

    return { direct, subGroups };
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  _render(hintOverride) {
    this._renderHeader(hintOverride);
    this._renderBody();
  }

  _renderHeader(hintOverride) {
    this._headerEl.empty();

    if (this.currentModifiers.length > 0) {
      this._headerEl.createEl('span', { cls: 'which-key-mod',  text: modsToDisplay(this.currentModifiers) });
      this._headerEl.createEl('span', { cls: 'which-key-plus', text: ' + …' });
    } else {
      this._headerEl.createEl('span', { cls: 'which-key-mod', text: 'All bindings' });
    }

    const hint = hintOverride ??
      (this.currentModifiers.length > 0
        ? 'key: execute  ·  modifier: drill in  ·  Esc: back'
        : 'modifier: drill in  ·  Esc: close');
    this._headerEl.createEl('span', { cls: 'which-key-hint', text: hint });

    const closeBtn = this._headerEl.createEl('button', { cls: 'which-key-close', text: '✕' });
    closeBtn.setAttribute('tabindex', '-1');
    closeBtn.addEventListener('click', () => this.plugin._closePopup());
  }

  _renderBody() {
    this._bodyEl.empty();
    const { direct, subGroups } = this._getViewData();

    const hasSubGroups = subGroups.length > 0;
    const hasDirect    = direct.length > 0;

    if (hasSubGroups) {
      const section = this._bodyEl.createEl('div', { cls: 'which-key-section' });
      if (hasDirect) {
        section.createEl('div', { cls: 'which-key-section-label', text: 'Drill deeper' });
      }
      const grid = section.createEl('div', { cls: 'which-key-grid which-key-grid--groups' });

      for (const group of subGroups) {
        const item = grid.createEl('div', { cls: 'which-key-item which-key-item--group' });

        const badge = item.createEl('kbd', { cls: 'which-key-key which-key-key--group' });
        badge.createEl('span', { text: modToDisplay(group.mod) });
        badge.createEl('span', { cls: 'which-key-arrow', text: ' ›' });

        const desc = item.createEl('div', { cls: 'which-key-group-desc' });
        desc.createEl('span', { cls: 'which-key-group-combo', text: modsToDisplay(group.fullMods) });
        desc.createEl('span', { cls: 'which-key-group-count', text: `${group.count} binding${group.count !== 1 ? 's' : ''}` });

        item.addEventListener('click', () => {
          this.currentModifiers = [...group.fullMods];
          this._render();
        });
      }
    }

    if (hasDirect) {
      const section = this._bodyEl.createEl('div', { cls: 'which-key-section' });
      if (hasSubGroups) {
        section.createEl('div', { cls: 'which-key-section-label', text: 'Bindings' });
      }
      const grid = section.createEl('div', { cls: 'which-key-grid' });

      for (const cmd of direct) {
        const item = grid.createEl('div', { cls: 'which-key-item' });
        item.createEl('kbd',  { cls: 'which-key-key',  text: cmd.display });
        item.createEl('span', { cls: 'which-key-name', text: cmd.name });
        item.addEventListener('click', () => {
          this.plugin._closePopup();
          setTimeout(() => this.app.commands.executeCommandById(cmd.commandId), 50);
        });
      }
    }

    if (!hasSubGroups && !hasDirect) {
      this._bodyEl.createEl('div', {
        cls:  'which-key-empty',
        text: `No bindings for ${modsToDisplay(this.currentModifiers) || 'any modifier'}`,
      });
    }
  }

  // ── Key handling ──────────────────────────────────────────────────────────

  _handleKey(e) {
    const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift']);

    if (e.key === 'Escape') {
      if (this.currentModifiers.length > 1) {
        this.currentModifiers.pop();
        this._render();
      } else {
        this.plugin._closePopup();
      }
      return;
    }

    if (MODIFIER_KEYS.has(e.key)) {
      if (e.repeat) return;
      const newMod = this.plugin._keyToObsidianMod(e.key);
      if (newMod && !this.currentModifiers.includes(newMod)) {
        this.currentModifiers.push(newMod);
        this._render();
      }
      return;
    }

    const { direct } = this._getViewData();
    const pressedKey = e.key.toLowerCase();
    const match      = direct.find(cmd => cmd.key.toLowerCase() === pressedKey);

    if (match) {
      this.plugin._closePopup();
      setTimeout(() => this.app.commands.executeCommandById(match.commandId), 50);
    } else {
      const combo = `${modsToDisplay(this.currentModifiers)}${e.key.toUpperCase()}`;
      this._render(`✗  no binding: ${combo}`);
      setTimeout(() => this.plugin._closePopup(), 1400);
    }
  }

  onClose() {
    if (!this._suppressPluginReset) {
      this.plugin.isShowingPopup = false;
      this.plugin.modal = null;
    }
    this.contentEl.empty();
  }
}

// ─── Settings tab ────────────────────────────────────────────────────────────

class WhichKeySettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Which Key' });

    new Setting(containerEl)
      .setName('Delay (ms)')
      .setDesc('How long to hold a modifier key before the popup appears.')
      .addText(text => text
        .setPlaceholder('400')
        .setValue(String(this.plugin.settings.delay))
        .onChange(async (val) => {
          const n = parseInt(val, 10);
          if (!isNaN(n) && n >= 0) { this.plugin.settings.delay = n; await this.plugin.saveSettings(); }
        }));

    new Setting(containerEl)
      .setName('Show in editor')
      .setDesc('Intercept keys when a note is open in edit mode.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showInEditor)
        .onChange(async (val) => { this.plugin.settings.showInEditor = val; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Columns')
      .setDesc('Number of columns in the binding grid (1–4).')
      .addSlider(slider => slider
        .setLimits(1, 4, 1)
        .setValue(this.plugin.settings.columns)
        .setDynamicTooltip()
        .onChange(async (val) => { this.plugin.settings.columns = val; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Modal width (px)')
      .setDesc('Width of the popup window.')
      .addText(text => {
        text
          .setPlaceholder('720')
          .setValue(String(this.plugin.settings.modalWidth))
          .onChange(async (val) => {
            const n = parseInt(val, 10);
            if (!isNaN(n) && n >= 300) { this.plugin.settings.modalWidth = n; await this.plugin.saveSettings(); }
          });
        text.inputEl.style.width = '80px';
      });
  }
}

module.exports = WhichKeyPlugin;
