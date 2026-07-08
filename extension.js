// cpu-watt-monitor@tofiq — extension.js  (v2)
// GNOME 45–50  •  ES-module syntax
//
// Changes from v1:
//   • Accepts extensionPath so the SVG icon can be loaded from the extension dir
//   • Replaces the ⚡ emoji with a proper St.Icon (symbolic SVG)
//   • Panel widget is now an HBox: [icon] [text label]

import GLib from "gi://GLib";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

// ── RAPL sysfs paths ─────────────────────────────────────────────────────────
const RAPL_BASE = "/sys/class/powercap/intel-rapl/intel-rapl:0";
const RAPL_BASE_soc = "/sys/class/powercap/intel-rapl/intel-rapl:1";
const ENERGY_PATH = `${RAPL_BASE}/energy_uj`;
const ENERGY_PATH_soc = `${RAPL_BASE_soc}/energy_uj`;
const MAX_RANGE_PATH = `${RAPL_BASE}/max_energy_range_uj`;
const MAX_RANGE_PATH_soc = `${RAPL_BASE_soc}/max_energy_range_uj`;
// ── Tunables ─────────────────────────────────────────────────────────────────
const POLL_SECONDS = 2;

// ── Helpers ──────────────────────────────────────────────────────────────────
function readSysfsInt(path) {
  try {
    const [ok, raw] = GLib.file_get_contents(path);
    if (!ok) return null;
    const v = parseInt(new TextDecoder().decode(raw).trim(), 10);
    return Number.isFinite(v) ? v : null;
  } catch (_) {
    return null;
  }
}

// ── Indicator ────────────────────────────────────────────────────────────────
const CpuWattIndicator = GObject.registerClass(
  { GTypeName: "CpuWattIndicator" },
  class CpuWattIndicator extends PanelMenu.Button {
    /**
     * @param {string} uuid          – extension UUID (used as role string)
     * @param {string} extensionPath – absolute path to the extension directory
     */
    constructor(uuid, extensionPath) {
      super(0.0, uuid, false);

      // ── Panel widget: [SVG icon] [text label] ────────────────────────────
      const box = new St.BoxLayout({ style_class: "cpu-watt-box" });

      // Gio.FileIcon loads the SVG directly from the extension's icons/ dir,
      // bypassing the system icon theme entirely — no installation step needed.
      const iconFile = Gio.File.new_for_path(
        `${extensionPath}/icons/cpu-watt-symbolic.svg`,
      );
      const icon = new St.Icon({
        gicon: new Gio.FileIcon({ file: iconFile }),
        icon_size: 16,
        style_class: "system-status-icon cpu-watt-icon",
        y_align: Clutter.ActorAlign.CENTER,
      });
      box.add_child(icon);

      this._wattLabel = new St.Label({
        text: "-- W",
        y_align: Clutter.ActorAlign.CENTER,
        style_class: "cpu-watt-label",
      });
      box.add_child(this._wattLabel);

      this.add_child(box);

      // ── Popup menu ───────────────────────────────────────────────────────
      this._peakItem = new PopupMenu.PopupMenuItem("Peak: -- W • SoC: -- W", {
        reactive: false,
      });
      this.menu.addMenuItem(this._peakItem);

      this.menu.addMenuItem(
        new PopupMenu.PopupMenuItem("Max shown SoC watt is 30W", {
          reactive: false,
        }),
      );

      const resetItem = new PopupMenu.PopupMenuItem("Reset peak");
      resetItem.connect("activate", () => {
        this._peakWatts = 0;
        this._peakItem.label.set_text("Peak: -- W");
      });
      this.menu.addMenuItem(resetItem);

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
      this.menu.addMenuItem(
        new PopupMenu.PopupMenuItem("Source: Intel RAPL  •  Domain: Package", {
          reactive: false,
        }),
      );

      // ── State ────────────────────────────────────────────────────────────
      this._lastEnergyUj = null;
      this._lastEnergyUj_soc = null;
      this._lastTimeUs = null;
      this._maxRangeUj = readSysfsInt(MAX_RANGE_PATH) ?? 262144000000;
      this._maxRangeUj_soc = readSysfsInt(MAX_RANGE_PATH_soc) ?? 262144000000;
      this._peakWatts = 0;
    }

    update() {
      const nowEnergyUj = readSysfsInt(ENERGY_PATH);
      const nowEnergyUj_soc = readSysfsInt(ENERGY_PATH_soc);
      const nowTimeUs = GLib.get_monotonic_time();

      if (nowEnergyUj === null) {
        this._wattLabel.set_text("EPERM");
        this._peakItem.label.set_text(
          "Peak: -- W  (permission error - restart the service)",
        );
        return;
      }

      if (this._lastEnergyUj !== null) {
        const dtUs = nowTimeUs - this._lastTimeUs;

        // Handle RAPL counter wrap
        let dEUj = nowEnergyUj - this._lastEnergyUj;
        if (dEUj < 0) dEUj += this._maxRangeUj;

        const watts = dEUj / dtUs; // µJ / µs = W  ✓

        if (watts > this._peakWatts) this._peakWatts = watts;

        this._wattLabel.set_text(`${watts.toFixed(1)} W`);

        if (nowEnergyUj_soc !== null && this._lastEnergyUj_soc !== null) {
          let dEUj_soc = nowEnergyUj_soc - this._lastEnergyUj_soc;
          if (dEUj_soc < 0) dEUj_soc += this._maxRangeUj_soc;
          const watts_soc = dEUj_soc / dtUs;
          this._peakItem.label.set_text(
            `Peak: ${this._peakWatts.toFixed(1)} W • SoC: ${watts_soc.toFixed(1)} W`,
          );
        } else {
          this._peakItem.label.set_text(
            `Peak: ${this._peakWatts.toFixed(1)} W • SoC: N/A`,
          );
        }
      }

      this._lastEnergyUj = nowEnergyUj;
      this._lastEnergyUj_soc = nowEnergyUj_soc;
      this._lastTimeUs = nowTimeUs;
    }

    destroy() {
      super.destroy();
    }
  },
);

// ── Extension entry point ────────────────────────────────────────────────────
export default class CpuWattExtension extends Extension {
  enable() {
    // this.path → absolute path to the extension directory (GNOME 45+ API)
    this._indicator = new CpuWattIndicator(this.metadata.uuid, this.path);

    // 'left' panel box, index 1 → immediately right of Activities button
    Main.panel.addToStatusArea(this.metadata.uuid, this._indicator, 4, "left");

    this._timerId = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      POLL_SECONDS,
      () => {
        this._indicator?.update();
        return GLib.SOURCE_CONTINUE;
      },
    );

    // Populate immediately; don't leave the label blank for POLL_SECONDS
    this._indicator.update();
  }

  disable() {
    if (this._timerId) {
      GLib.source_remove(this._timerId);
      this._timerId = null;
    }
    this._indicator?.destroy();
    this._indicator = null;
  }
}
