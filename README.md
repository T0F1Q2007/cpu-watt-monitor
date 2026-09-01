# Intel RAPL Power Dissipation Telemetry for GNOME Shell

An asynchronous GNOME Shell extension engineered for real-time monitoring and numerical analysis of Intel CPU package and System-on-Chip (SoC) active power dissipation via the Linux kernel Running Average Power Limit (RAPL) powercap interface.

---

## Abstract and Theoretical Background

Modern microprocessor architectures implement hardware energy counters to expose dynamic power consumption metrics. The Intel Running Average Power Limit (RAPL) interface exposes cumulative energy counters derived from Model-Specific Registers (MSRs) and makes them accessible to user space through the Linux `powercap` sysfs subsystem (`/sys/class/powercap/intel-rapl/`).

Rather than relying on periodic execution of privileged external binaries (such as `intel-undervolt measure` or `turbostat`), which introduce significant context switching, process spawning overhead, and scheduling latency, this extension samples kernel sysfs nodes directly within the GNOME Shell SpiderMonkey JavaScript runtime environment.

### Mathematical Formulation of Differential Energy Sampling

The RAPL sysfs interface reports energy consumption as a monotonically increasing 32-bit or 64-bit integer quantified in microjoules ($\mu\text{J}$). Instantaneous power dissipation cannot be read directly from hardware; it must be calculated over a discrete time delta:

$$\Delta E = \begin{cases} 
E_t - E_{t-1}, & \text{if } E_t \ge E_{t-1} \\
(E_t - E_{t-1}) + E_{\text{max}}, & \text{if } E_t < E_{t-1} \quad (\text{counter overflow})
\end{cases}$$

$$\Delta t = t_t - t_{t-1}$$

$$P_{\text{average}} = \frac{\Delta E}{\Delta t} \quad \left[\frac{\mu\text{J}}{\mu\text{s}} \equiv \frac{\text{Joules}}{\text{second}} \equiv \text{Watts}\right]$$

where:
* $E_t$ denotes the instantaneous cumulative energy reading at monotonic time $t$.
* $E_{\text{max}}$ denotes the maximum energy range before hardware counter wraparound, defined in `max_energy_range_uj`.
* $\Delta t$ is obtained via `GLib.get_monotonic_time()`, providing microsecond-level precision.

---

## Architectural Implementation

```
+-----------------------------------------------------------------------+
|                       GNOME Shell Top Panel Bar                       |
|                   CpuWattIndicator (PanelMenu.Button)                 |
+-----------------------------------^-----------------------------------+
                                    |
                    GLib 2.0s Periodic Event Loop
                                    |
+-----------------------------------v-----------------------------------+
|               Differential RAPL Metric Evaluator Engine               |
|  - Module-level TextDecoder singleton (zero GC allocation)            |
|  - Monotonic microsecond clock difference evaluation                  |
|  - Adaptive domain presence caching (intel-rapl:0 & intel-rapl:1)     |
+-----------------------------------^-----------------------------------+
                                    |
                Direct Virtual File Read (GLib.file_get_contents)
                                    |
+-----------------------------------v-----------------------------------+
|                        Linux Kernel Powercap sysfs                    |
|       /sys/class/powercap/intel-rapl/intel-rapl:0/energy_uj           |
|       /sys/class/powercap/intel-rapl/intel-rapl:1/energy_uj           |
+-----------------------------------------------------------------------+
```

### RAPL Domain Topology

| Domain Index | Identifier | Hardware Subsystem Description |
|---|---|---|
| `intel-rapl:0` | Package (`pkg`) | Total energy consumed by the entire processor die (Cores, Uncore, Memory Controller, Integrated Graphics). |
| `intel-rapl:0:0` | Core (`core`) | Non-graphics compute cores. |
| `intel-rapl:0:1` | Uncore (`uncore`) | Integrated GPU and system agent. |
| `intel-rapl:1` | Platform (`psys` / SoC) | Platform SoC energy domain (present on select mobile and workstation platforms). |

The package domain (`intel-rapl:0`) provides the definitive measure of processor thermal design power (TDP) dissipation.

---

## Installation and System Configuration

### 1. File Placement

Deploy the extension package to the local GNOME Shell extensions directory:

```bash
mkdir -p ~/.local/share/gnome-shell/extensions/cpu-watt-monitor@tofiq
cp -r ./* ~/.local/share/gnome-shell/extensions/cpu-watt-monitor@tofiq/
```

### 2. Discretionary Access Control (DAC) Permissions

By default, Linux restricts read access to RAPL sysfs counters to the `root` superuser. To grant read permissions to the unprivileged desktop session, deploy either a systemd oneshot unit or a udev administrative rule.

#### Method A: systemd Service Deployment (Recommended)

Deploy the bundled systemd unit to enforce persistent file mode permissions at boot:

```bash
sudo cp startup-chmod-intelrapl-service.service /etc/systemd/system/rapl-permission.service
sudo systemctl daemon-reload
sudo systemctl enable --now rapl-permission.service
```

#### Method B: udev Rule Specification

Alternatively, declare dynamic rules in `/etc/udev/rules.d/90-rapl.rules`:

```bash
sudo tee /etc/udev/rules.d/90-rapl.rules << 'EOF'
SUBSYSTEM=="powercap", ACTION=="add", RUN+="/bin/sh -c '/bin/chmod o+r /sys/class/powercap/intel-rapl/intel-rapl:*/energy_uj'"
EOF

sudo udevadm control --reload-rules
sudo udevadm trigger --subsystem-match=powercap
sudo chmod o+r /sys/class/powercap/intel-rapl/intel-rapl:*/energy_uj
```

### 3. Extension Activation

Enable the extension within the GNOME Shell environment:

```bash
gnome-extensions enable cpu-watt-monitor@tofiq
```

Under Wayland sessions, changes take effect immediately. Under legacy X11 sessions, the shell can also be restarted via `Alt + F2`, entering `r`, and pressing Enter.

---

## User Interface and Diagnostic States

* **Panel Indicator**: Displays live active power dissipation formatted to one decimal precision (e.g., `14.2 W`).
* **Telemetry Menu**:
  * **Session Peak Metric**: Tracks and displays the maximum observed wattage during the desktop session.
  * **SoC Telemetry**: Renders secondary SoC power draw when platform registers are detected.
  * **Reset Control**: Resets peak value accumulation.
* **Error States**:
  * `EPERM`: Indicates insufficient DAC read permissions on `/sys/class/powercap/intel-rapl/intel-rapl:0/energy_uj`. Execute the permission configuration steps above.

---

## Uninstallation

```bash
gnome-extensions disable cpu-watt-monitor@tofiq
rm -rf ~/.local/share/gnome-shell/extensions/cpu-watt-monitor@tofiq
```

---

## License

This software is distributed under the terms of the GNU General Public License v3.0 (GPL-3.0).
