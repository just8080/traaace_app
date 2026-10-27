**TRAAACE** tags New Zealand trail camera photos and videos quickly, on your own computer. Your photos and results never leave it.

## Download

| Your computer | File |
| --- | --- |
| Mac with Apple Silicon (M1, M2, M3, M4) | `TRAAACE_..._aarch64.dmg` |
| Mac with an Intel processor | `TRAAACE_..._x64.dmg` |
| Windows | `TRAAACE_..._x64-setup.exe` (or the `.msi`) |
| Linux | `TRAAACE_..._amd64.AppImage` or `.deb` |

Not sure which Mac you have? Apple menu → About This Mac: "Chip: Apple M…" is Apple Silicon, "Processor: Intel" is Intel.

## Optional AI species suggestions

TRAAACE can suggest the species and number of animals in each photo or video, on your own computer. It needs a free add-on (about 511 MB), which TRAAACE offers to download the first time you press **Set up AI…**. It works on Apple Silicon Macs, Windows and Linux, but not on Intel Macs yet. Videos take much longer to scan than photos.

## Opening it the first time

TRAAACE isn't signed with a paid developer certificate yet, so your computer will warn you the first time. That is expected.

- **Mac:** open the `.dmg`, drag TRAAACE to Applications, then **right-click it and choose Open** (and Open again in the dialog). If macOS says the app is damaged, open Terminal and run `xattr -dr com.apple.quarantine /Applications/TRAAACE.app`.
- **Windows:** if SmartScreen appears, click **More info → Run anyway**. (It needs Microsoft's WebView2, which Windows 10 and 11 already include.)
- **Linux (Ubuntu):** the simplest is the `.deb`: `sudo apt install ./TRAAACE_*_amd64.deb`. For the AppImage, run `chmod +x TRAAACE_*.AppImage` first, and on Ubuntu you may need `sudo apt install libfuse2` (`libfuse2t64` on 24.04).

Questions or problems? Email [hello@traaace.ing](mailto:hello@traaace.ing) and tell us what you did and, if you can, include a screenshot.
