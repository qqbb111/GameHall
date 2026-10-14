# 本地中文字体

Web 使用同站提供的 Noto Sans SC 与 Noto Serif SC 可变 WOFF2 字体。字体由 Vite 当作 `src/assets` 资源处理，构建后文件名含内容哈希；页面使用 `font-display: swap` 和系统字体回退，因此字体下载期间仍可显示界面。字库包含当前 Web 源码中 Noto 支持的可打印字符、ASCII 与 GB2312 一级 3755 个常用汉字。源字体没有的 `⌄`（U+2304）、表情和其他用户输入字符由浏览器系统字体回退。

两份子集字体分别由 Google Fonts 仓库固定提交 `66928797f271fed5ee428544e7229685e2d90127` 的可变 TTF 生成：

| 字体 | 原始文件 | Git blob SHA-1 | 许可 |
| --- | --- | --- | --- |
| Noto Sans SC | `ofl/notosanssc/NotoSansSC[wght].ttf` | `fb0637bafbcd804fe32152370a1225990745b4bc` | [`OFL.txt`](../../apps/web/src/assets/fonts/OFL-NotoSansSC.txt) |
| Noto Serif SC | `ofl/notoserifsc/NotoSerifSC[wght].ttf` | `eab063faf229160a52d3760f5555150e4eb9e5bf` | [`OFL.txt`](../../apps/web/src/assets/fonts/OFL-NotoSerifSC.txt) |

生成时使用 Python 3.12、`fonttools==4.66.1` 和 `brotli==1.2.0`。原始 TTF 与 Python 虚拟环境保存在仓库外，不随项目发布。下面的命令将下载文件放入自选临时目录，再生成仓库内 WOFF2；脚本会校验源文件的 Git blob SHA-1，拒绝其他版本。

```powershell
$fontSource = 'C:\temp\gamehall-font-sources'
New-Item -ItemType Directory -Force $fontSource | Out-Null
curl.exe -fL -o "$fontSource\NotoSansSC.ttf" 'https://raw.githubusercontent.com/google/fonts/66928797f271fed5ee428544e7229685e2d90127/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf'
curl.exe -fL -o "$fontSource\NotoSerifSC.ttf" 'https://raw.githubusercontent.com/google/fonts/66928797f271fed5ee428544e7229685e2d90127/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf'
python -m venv "$fontSource\.venv"
& "$fontSource\.venv\Scripts\python.exe" -m pip install fonttools==4.66.1 brotli==1.2.0
& "$fontSource\.venv\Scripts\python.exe" scripts/build_local_fonts.py $fontSource
& "$fontSource\.venv\Scripts\python.exe" scripts/verify_local_fonts.py
```

每次增添界面文案时，运行 `python scripts/verify_local_fonts.py` 检查现有子集是否覆盖新字符；不足时重新生成并提交字体文件。两份字体均按照各自的 SIL Open Font License 1.1 发布；上方链接保存原版权声明及完整许可文本。Sans 的保留字体名称为 `Source`，本项目没有使用该名称作为修改字体的主名称。
