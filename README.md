# cpu-watt-monitor — GNOME Shell Extension

Displays **Intel CPU Package power draw** (the authoritative RAPL total) on the
**left side** of the GNOME panel, with a session-peak tracker accessible via the
indicator's popup menu.

---

## Why RAPL sysfs instead of `intel-undervolt measure`?

`sudo intel-undervolt measure` is itself just a thin wrapper that reads the same
RAPL energy counters exposed in sysfs — it does nothing that the kernel doesn't
already make available.  Running a privileged subprocess from a GNOME Shell
extension every 2 seconds would be fragile and slow.  Reading the sysfs files
directly is instantaneous and keeps everything inside the extension process.

### The four values `intel-undervolt measure` reports

| Label shown       | RAPL domain         | sysfs node               |
|-------------------|---------------------|--------------------------|
| **Package**       | Full CPU die        | `intel-rapl:0`           |
| Core              | Execution cores     | `intel-rapl:0:0`         |
| Uncore            | iGPU + MCH          | `intel-rapl:0:1`         |
| Analog I/O (PSYS) | Platform (optional) | `intel-rapl:1` if present|

**Package is always the highest and most representative figure** — it is the sum
of everything else and is exactly what a power meter on the CPU socket would
read.  The extension exclusively reads Package.

### Why the numbers differ between runs

RAPL measures a rolling hardware average over its internal time window (~1 ms).
Every time you call `intel-undervolt measure`, you catch the processor at a
different point in its dynamic power curve.  The extension solves this by
computing **Δenergy / Δtime** across a 2-second window, which yields a smooth,
meaningful average rather than a noisy instantaneous snapshot.

---

## Installation

```bash
# 1. Copy the extension folder
cp -r cpu-watt-monitor@tofiq ~/.local/share/gnome-shell/extensions/

# 2. Fix RAPL read permissions (one-time, survives reboots)
sudo tee /etc/udev/rules.d/90-rapl.rules << 'EOF'
SUBSYSTEM=="powercap", ACTION=="add", RUN+="/bin/chmod o+r /sys/class/powercap/intel-rapl/intel-rapl:0/energy_uj"
EOF

# Apply the rule immediately without rebooting:
sudo udevadm trigger --subsystem-match=powercap
sudo chmod o+r /sys/class/powercap/intel-rapl/intel-rapl:0/energy_uj

# 3. Enable the extension (no restart needed on GNOME 45+)
gnome-extensions enable cpu-watt-monitor@tofiq
```

> **Alternative without udev:** `sudo chmod o+r /sys/class/powercap/intel-rapl/intel-rapl:0/energy_uj`
> This resets on reboot without the udev rule.

---

## Usage

- **Panel label** — live wattage updated every 2 seconds, e.g. `⚡ 12.4 W`
- **Click the label** → popup menu shows:
  - Session peak wattage
  - "Reset peak" item to zero the peak tracker
  - Domain reminder (Package / RAPL)
- **`⚡ EPERM`** in the label means the sysfs file isn't readable yet — apply the
  udev rule above.

---

## Uninstall

```bash
gnome-extensions disable cpu-watt-monitor@tofiq
rm -rf ~/.local/share/gnome-shell/extensions/cpu-watt-monitor@tofiq
```
