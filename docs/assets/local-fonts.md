# 本地中文字体

Web 使用同站提供的 Noto Sans SC 与 Noto Serif SC 可变 WOFF2 字体。每套字体按字符分成 `core` 与 `common` 两份：`core` 包含当前 Web 源码和推箱子关卡文案中 Noto 支持的文字、标点和 ASCII；`common` 补齐 GB2312 一级 3755 个常用汉字中尚未进入 `core` 的字符。两组字符互不重叠，合并后共 3886 个字符。生成的 [`font-faces.css`](../../apps/web/src/font-faces.css) 以精确 `unicode-range` 按需选择字库；页面使用 `font-display: swap` 和系统字体回退，字体下载期间仍可显示界面。

| 字库 | 字符数 | WOFF2 大小 | 用途 |
| --- | ---: | ---: | --- |
| Sans `core` | 822 | 240,124 B | 当前界面文字 |
| Serif `core` | 822 | 315,284 B | 当前界面标题与装饰文字 |
| Sans `common` | 3064 | 851,484 B | 其他常用汉字 |
| Serif `common` | 3064 | 1,121,608 B | 其他常用汉字 |

首次显示当前界面只需两份 `core`，合计 555,408 B；遇到 `common` 字符时浏览器再请求对应字库。四份字体由 Vite 当作 `src/assets` 资源处理，构建后文件名含内容哈希。源字体没有的 `⌄`（U+2304）、表情和其他字集外的用户输入字符由系统字体回退。

两套子集字库分别由 Google Fonts 仓库固定提交 `66928797f271fed5ee428544e7229685e2d90127` 的可变 TTF 生成：

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

每次增添界面文案时，运行 `python scripts/verify_local_fonts.py` 检查现有 `core` 是否覆盖新字符，以及四份 WOFF2 的 cmap、可变字重、许可元数据与 CSS 范围是否一致；不足时重新生成并提交字库与 `font-faces.css`。四份字体仍分别按照所属家族的 SIL Open Font License 1.1 发布；上方链接保存原版权声明及完整许可文本。Sans 的保留字体名称为 `Source`，本项目没有使用该名称作为修改字体的主名称。
