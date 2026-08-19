# DeveloperHCR: AI Agent

A local-first desktop, mobile and terminal environment for running the DeveloperHCR workspace across Windows, Linux/Kali Linux, Android/Termux and browser-capable systems.

> **Important:** This README describes the project's features and operation only. It intentionally does not list a software version.

<details>
<summary><strong>▼ Features</strong></summary>

### Desktop and workspace
- Windows-style desktop with taskbar, launcher, movable windows, minimize/maximize, resize and full-screen controls.
- Device-aware presentation: desktop/PC UI for computers and a Termux-safe UI for Android terminals.
- Landscape-first layout with orientation controls where the host platform permits them.
- Direct launcher workflow on supported desktop systems, with browser/headless compatibility available when needed.
- Top-area Settings access and organized application controls.
- Theme, zoom, full-screen, mouse/cursor and keyboard support.
- Wallpaper selector with built-in visual themes and HD backgrounds.
- DeveloperHCR branding and logo throughout the interface.
- Animated startup/login presentation and lightweight UI sound feedback.

### Accounts and access
- First-run user-facing Admin creation flow.
- Admin authentication and role-based access controls.
- Remember-me login and optional Quick Unlock PIN.
- Admin recovery/management controls from Settings.
- Friends Only and Subscribers Only access controls.
- One-time File Checkup with countdown and Skip control, plus recovery behavior when enabled.
- Troubleshooting and local diagnostics for common installation/runtime problems.

### Apps and Store
- HCR Store for free and paid applications.
- Explicit app installation and access controls.
- Searchable application launcher with individual icons and organized categories.
- Separate Games area so games do not clutter the main desktop.
- Built-in games framework for lightweight 2D, 3D and voxel-style experiences.
- File Manager, storage tools, notes, calculator, system monitor and task-management utilities.
- Backup and restore workflows for local application data.
- Drag-and-drop support where the host platform allows it.

### AI and developer tools
- HCR voice/assistant framework with command-safety controls and runtime status handling.
- AI provider/model detection and Ollama integration where available.
- GGUF model management with explicit download actions.
- Developer toolkit with code editing, playground and local development utilities.
- Terminal integration for local developer commands.
- Safe command policy so dangerous operations are not silently authorized.
- Platform capability detection so unsupported features are reported instead of pretending to work.

### Platform support
- Windows setup and direct launcher scripts.
- Linux and Kali Linux setup and launcher scripts.
- Android/Termux setup designed for Termux private storage rather than Android shared-storage virtual environments.
- Network, Bluetooth and other device capabilities are exposed only when supported by the host system.
- EXE/Wine compatibility hooks on platforms where the required runtime exists.
- Local-first operation with optional network features rather than a permanent online requirement.

### Updates and repository integration
- Update Center with configurable GitHub repository support.
- GitHub release/tag checking and update archive validation.
- Repository information and support links are available from the application where appropriate.

</details>

<details>
<summary><strong>▼ Manual Guide — Windows</strong></summary>

1. Extract the project folder to a normal writable location.
2. Run `setup_windows.bat` once.
3. Start the application with `start_windows.bat`.
4. On the first run, complete the Admin creation screen.
5. Use the top Settings control to configure access, assistant, appearance and health options.
6. Use the launcher to open Store, Games, AI, File Manager and other tools.

If Windows blocks a script, open Command Prompt in the project folder and run the setup script from there.

</details>

<details>
<summary><strong>▼ Manual Guide — Linux / Kali Linux</strong></summary>

1. Open a terminal in the extracted project directory.
2. Run `bash setup_linux.sh`.
3. Start the launcher with `python launcher.py`.
4. Complete the Admin setup on the first run.
5. Use the desktop UI for applications and Settings.

Keep the project in a writable directory. Avoid running the project from a read-only mount.

</details>

<details>
<summary><strong>▼ Manual Guide — Android / Termux</strong></summary>

1. Open Termux and enter the extracted project directory.
2. Run:

```bash
bash setup_termux.sh
```

3. When setup finishes, run:

```bash
python launcher.py
```

4. If the setup script creates a Termux virtual environment, keep using the environment created by the script.
5. Do not create the Python virtual environment directly inside `/storage/emulated/0/...`; Android shared storage can cause `lib64` permission/symlink errors.
6. If the launcher reports missing packages, use the command it prints for the Termux requirements file rather than installing an incompatible desktop-only dependency set.

The browser-compatible UI can still be used when a platform cannot provide a native desktop window.

</details>

<details>
<summary><strong>▼ First Run and Daily Use</strong></summary>

### First run
- Create the user-facing Admin when no Admin exists.
- Configure optional Quick Unlock only if you want it.
- Choose access restrictions such as Friends Only or Subscribers Only from Settings when required.
- Complete File Checkup once if it is enabled.

### Later launches
- A remembered session can take you directly to the main environment instead of asking for credentials every time.
- Quick Unlock appears only when a PIN has actually been configured.
- File Checkup is controlled by the health/checkup setting and is not intended to interrupt every normal launch.

### When something is unavailable
- Check the Troubleshoot/health tools first.
- Confirm that the required runtime is installed for the platform.
- Use the platform-specific setup script.
- Features that the host cannot provide are reported as unavailable instead of being presented as fake working controls.

</details>

<details>
<summary><strong>▼ GitHub Release / Assets Arrow</strong></summary>

GitHub itself provides an **Assets** section on a Release page. The small arrow beside **Assets** expands or collapses the downloadable files. That arrow is part of GitHub's interface and is not controlled by the README.

For this project, place the distributable ZIP/archive in the GitHub Release **Assets** area. Users can then open the Release page and click the Assets arrow to reveal the download files.

The README also uses the same expandable-arrow style (`<details>` / `<summary>`) for long feature and manual-guide sections, so the project page stays clean while the full information remains available on click.

</details>

<details>
<summary><strong>▼ Repository</strong></summary>

Official project repository:

https://github.com/DevevoperHCR/HCRAPP

</details>

<details>
<summary><strong>▼ Included Files and Media</strong></summary>

- Application source and runtime modules.
- Windows, Linux/Kali Linux and Termux setup/launcher scripts.
- Static UI, JavaScript and CSS assets.
- DeveloperHCR logo, sounds and wallpaper assets.
- Selected project screenshots/reference photos in the media folder.
- Tests and configuration required by the project.
- This feature-focused README and the manual instructions above.

</details>

## Notes

- The project is designed to keep platform-specific behavior separate so Android/Termux-only constraints do not unnecessarily affect desktop systems.
- Native desktop launching depends on the operating system and its available Python/runtime capabilities; the browser/headless UI is retained as a compatibility path.
- Network-dependent features require network access, while the local workspace and core UI are designed to remain local-first.
 
