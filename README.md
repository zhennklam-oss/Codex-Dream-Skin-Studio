# Codex Dream Skin Studio

[中文](#中文) · [English](#english)

> An unofficial Windows visual theme controller for Codex, built with Tauri 2 and React.

## 中文

### 项目简介

Codex Dream Skin Studio 是一个面向 Windows 的 Codex 可视化主题控制器。它把经过验证的 Dream Skin 注入引擎封装进 Tauri 2 + React 桌面应用，让用户通过主题库、图片画布和实时预览管理 Codex 外观，而不需要手动运行 PowerShell 或 Node.js 脚本。

当前版本为 `0.2.0`，内置 `Engine 1.7.0`，使用 `Theme schema 5`。

### 0.2.0 更新内容

- 将 Studio 的界面透明度控制与 Codex 实际区域一一对应：左侧栏、顶栏、右侧审阅面板、底部终端面板和输入区现在分别控制各自的真实表面。
- 新增独立的输入区透明度；默认值保留 Codex 原生输入框的宽度、圆角、边框、阴影和布局，不再把输入框误当作 Bottom Panel。
- 主题升级到 schema 5，并自动迁移旧主题的输入区与面板透明度设置。
- Engine 1.7.0 使用语义表面状态验证注入结果，修复皮肤短暂生效后因旧 verifier 错判而回滚的问题。

### 0.1.1 更新内容

- 修复电脑长时间待机、睡眠或休眠后皮肤监视器失效的问题。Studio 会识别失去响应的监视器、修复运行状态，并恢复“应用更改”和“暂停皮肤”等操作，无需先恢复官方外观再重新启动皮肤。
- 发布构建恢复使用仓库内标准 Cargo 输出目录，安装包直接生成在 `src-tauri\target\release\bundle\nsis`。

### 功能

- 主题库：新建、复制、重命名、删除和一键切换主题。
- 图片：导入 PNG、JPEG 或 WebP；在画布中拖动图片，或直接调整 X/Y 位置和缩放。
- 基础效果：透明度、模糊度、饱和度、亮度和遮罩强度。
- 特殊色调：黑白、双色调和水洗色。
- 本地预览：在应用内即时查看图片位置和效果，点击“应用”后再同步到 Codex。
- 界面设置：可切换支持中英文显示的字体预设。
- 运行控制：启动、应用、暂停、恢复和恢复官方外观。
- 托盘控制：关闭窗口时隐藏到系统托盘；“彻底退出”是单独操作。
- 启动设置：可分别控制登录后启动应用，以及应用启动后自动启动皮肤。

### 系统要求

- Windows 11。
- Microsoft Edge WebView2。
- 受支持的目标是包含 `OpenAI.Codex` 的官方 Microsoft Store Codex 软件包。
- 安装包内置经过验证的 `Node.js 24.18.0`。只有内置运行时不可用时，才会回退到外部 `Node.js 22+`。

### 安装

从 GitHub Releases 下载并运行 `Codex Dream Skin Studio_0.2.0_x64-setup.exe`。标准安装会创建开始菜单和桌面快捷方式，并注册卸载入口。

首次运行时，应用会验证并同步随安装包提供的引擎。用户不需要保留原始 Codex-Dream-Skin 项目目录，也不需要另外安装 Node.js。

### 使用方法

1. 在左侧主题库选择现有主题，或新建一个主题。
2. 导入 PNG、JPEG 或 WebP 图片。
3. 在预览画布中拖动图片，或调整 X/Y、缩放、透明度及其他效果。
4. 点击“应用”把当前主题同步到 Codex。
5. 使用“启动皮肤”“暂停”或“恢复”控制运行状态。

Codex 启动后，渲染器可能需要一点时间才能准备完毕。Studio 会等待实际状态并刷新界面；短暂显示“正在等待 Codex 界面”并不代表启动失败。

启动皮肤和恢复官方外观使用对称的确认、等待和结果界面。底层命令超时后，Studio 会重新读取运行时并校准实际状态，避免皮肤已经生效却仍显示失败。

关闭 Studio 窗口只会把它隐藏到系统托盘，皮肤和快捷控制可以继续运行。如需结束 Studio，请在托盘菜单中选择“彻底退出”。

### 恢复官方外观

点击“恢复官方外观”并确认。Studio 会停止受管皮肤会话并让 Codex 回到官方外观；主题库和图片仍会保留，之后可以再次启动皮肤。

恢复操作不会修改或替换 Codex 官方安装包。引擎只连接本机 `127.0.0.1` loopback CDP，不编辑 WindowsApps、`app.asar` 或官方软件包签名。

### 数据与隐私

受管引擎、主题、图片、状态和日志保存在：

```text
%LOCALAPPDATA%\CodexDreamSkin
%LOCALAPPDATA%\CodexDreamSkinStudio
```

这些用户数据在卸载时会保留，以避免意外丢失主题。若要彻底清除数据，请先备份需要的主题，再手动删除上述目录。

皮肤引擎只连接本机 `127.0.0.1` loopback CDP。它不会上传主题图片，也不会改写 WindowsApps、`app.asar` 或官方软件包签名。

### 从源码构建

需要 Git、Rust 工具链、Node.js 和 npm。在仓库根目录运行：

```powershell
npm install
npm test -- --run
npm run tauri build
```

Cargo/Tauri 输出保存在仓库内受忽略的构建目录中。生成的 Windows 安装包路径为：

```text
src-tauri\target\release\bundle\nsis\Codex Dream Skin Studio_0.2.0_x64-setup.exe
```

### 测试

前端测试：

```powershell
npm test -- --run
```

完整发布验证还包括系统 Node.js 与内置 `Node.js 24.18.0` 的引擎测试、生命周期契约、Rust 测试、Clippy、Tauri 构建和安装包资源校验。不会在普通发布测试中自动重启 Codex、恢复官方外观或改变当前主题。

### 常见问题

**启动皮肤后仍在等待或显示超时**

Codex 渲染器准备就绪可能需要一些时间。先等待状态自动校准；如果 Codex 已经打开但状态没有更新，可重试一次并查看日志。

**在哪里查看日志？**

打开 Studio 中的“打开日志”，或检查 `%LOCALAPPDATA%\CodexDreamSkin` 下的日志文件。

**为什么提示找不到 Node.js？**

安装包内置 Node.js 24.18.0，外部 `Node.js 22+` 只是回退方案。Studio 不会修改或替换系统 Node.js，也不会改写 PATH、npm 或其他 Node 版本管理器。若内置运行时缺失或校验失败，Studio 会将受管引擎标记为未安装且不允许启动皮肤；请重新安装 Studio。切换外部 Node.js 后可使用“重新检测环境”。

**卸载会删除主题吗？**

不会。`%LOCALAPPDATA%\CodexDreamSkin` 和 `%LOCALAPPDATA%\CodexDreamSkinStudio` 默认保留。

### 项目状态与免责声明

这是一个非官方社区项目，不隶属于 OpenAI，也未获得 OpenAI 背书。Codex 界面或 Microsoft Store 软件包更新后，注入兼容性可能发生变化。使用前请保留重要主题和图片的副本。

本项目仅支持包含 `OpenAI.Codex` 的官方 Microsoft Store Codex 软件包，不修改 WindowsApps、`app.asar` 或官方软件包签名。

### 许可证

本项目采用 [MIT License](LICENSE)。

## English

### Overview

Codex Dream Skin Studio is a visual theme controller for Codex on Windows. It packages the verified Dream Skin injection engine in a Tauri 2 + React desktop app, so themes, image composition, and live preview can be managed without manually running PowerShell or Node.js scripts.

The current release is `0.2.0`, with `Engine 1.7.0` and `Theme schema 5`.

### What's new in 0.2.0

- Mapped Studio's interface opacity controls one-to-one with real Codex surfaces: the sidebar, top bar, review panel, bottom terminal panel, and composer are now controlled independently.
- Added dedicated composer opacity while preserving Codex's native input width, radius, border, shadow, and layout by default; the composer is no longer mistaken for the Bottom Panel.
- Upgraded themes to schema 5 with automatic migration of existing composer and panel opacity settings.
- Engine 1.7.0 verifies injection through semantic surface state, preventing successful skins from being rolled back by the legacy verifier.

### What's new in 0.1.1

- Fixed skin monitoring becoming unresponsive after prolonged standby, sleep, or hibernation. Studio now detects a stale watcher, repairs the runtime state, and restores actions such as Apply and Pause without requiring an official-appearance restore and skin restart.
- Release builds once again use the standard repository-local Cargo output directory, with the installer emitted directly under `src-tauri\target\release\bundle\nsis`.

### Features

- Theme library: create, copy, rename, delete, and switch themes in one click.
- Images: import PNG, JPEG, or WebP; drag the image on the canvas or set its X/Y position and scale directly.
- Core effects: opacity, blur, saturation, brightness, and mask intensity.
- Special tones: black-and-white, duotone, and wash tone.
- Local preview: see image placement and effects immediately, then use Apply to synchronize them to Codex.
- Interface settings: choose font presets that support both Chinese and English.
- Runtime controls: start, apply, pause, resume, and restore the official appearance.
- Tray controls: closing the window hides the app to the system tray; explicit Quit is a separate action.
- Startup switches: control launch at sign-in and automatic skin startup independently.

### Requirements

- Windows 11.
- Microsoft Edge WebView2.
- The supported target is the official Microsoft Store Codex package containing `OpenAI.Codex`.
- The installer bundles verified `Node.js 24.18.0`. An external `Node.js 22+` runtime is used only as a fallback when the bundled runtime is unavailable.

### Installation

Download `Codex Dream Skin Studio_0.2.0_x64-setup.exe` from GitHub Releases and run it. The standard installer creates Start menu and desktop shortcuts and registers an uninstall entry.

On first launch, the app verifies and synchronizes the bundled engine. Users do not need to keep the original Codex-Dream-Skin project directory or install Node.js separately.

### Usage

1. Select an existing theme in the library or create a new one.
2. Import a PNG, JPEG, or WebP image.
3. Drag the image in the preview, or adjust X/Y, scale, opacity, and other effects.
4. Select Apply to synchronize the current theme to Codex.
5. Use Start skin, Pause, or Resume to control the runtime.

The Codex renderer can take time to become ready after Codex starts. Studio waits for the actual state and refreshes the interface; a brief “waiting for Codex UI” state does not mean startup has failed.

Closing the Studio window only hides it to the system tray, where the skin and quick controls can continue running. Use the explicit Quit command in the tray menu to exit Studio.

### Restore the official appearance

Select Restore official appearance and confirm. Studio stops the managed skin session and returns Codex to its official appearance. Themes and images are retained, so the skin can be started again later.

Restoration does not modify or replace the official Codex installation. The engine connects only to the local `127.0.0.1` loopback CDP and does not edit WindowsApps, `app.asar`, or official package signatures.

### Data and privacy

The managed engine, themes, images, state, and logs are stored under:

```text
%LOCALAPPDATA%\CodexDreamSkin
%LOCALAPPDATA%\CodexDreamSkinStudio
```

These user data directories are retained on uninstall to prevent accidental theme loss. To remove everything, back up any themes you want to keep and then delete both directories manually.

The engine connects only to the local `127.0.0.1` loopback CDP. It does not upload theme images or rewrite WindowsApps, `app.asar`, or official package signatures.

### Build from source

Git, the Rust toolchain, Node.js, and npm are required. From the repository root, run:

```powershell
npm install
npm test -- --run
npm run tauri build
```

Cargo/Tauri output stays in the ignored repository-local build directory. The generated Windows installer is located at:

```text
src-tauri\target\release\bundle\nsis\Codex Dream Skin Studio_0.2.0_x64-setup.exe
```

### Tests

Run the frontend suite with:

```powershell
npm test -- --run
```

Full publication verification also covers the engine under the system Node.js runtime and bundled `Node.js 24.18.0`, lifecycle contracts, Rust tests, Clippy, the Tauri build, and installer payload validation. Normal publication checks do not automatically restart Codex, restore the official appearance, or change the active theme.

### Troubleshooting

**Startup is still waiting or reports a timeout**

The Codex renderer can take time to become ready. Allow the state to reconcile first. If Codex is already open but the status does not update, retry once and inspect the logs.

**Where are the logs?**

Use Open logs in Studio, or inspect the log files under `%LOCALAPPDATA%\CodexDreamSkin`.

**Why does Studio report that Node.js is missing?**

The installer includes `Node.js 24.18.0`; external `Node.js 22+` is only a fallback. If the bundled runtime is missing or fails verification, reinstall Studio. After switching an external Node.js installation, use Detect environment again.

**Does uninstalling remove themes?**

No. `%LOCALAPPDATA%\CodexDreamSkin` and `%LOCALAPPDATA%\CodexDreamSkinStudio` are retained by default.

### Project status and disclaimer

This is an unofficial community project and is not affiliated with or endorsed by OpenAI. Injection compatibility may change when the Codex interface or Microsoft Store package is updated. Keep copies of important themes and images.

The supported target is the official Microsoft Store Codex package containing `OpenAI.Codex`. This project does not modify WindowsApps, `app.asar`, or official package signatures.

### License

This project is licensed under the [MIT License](LICENSE).
