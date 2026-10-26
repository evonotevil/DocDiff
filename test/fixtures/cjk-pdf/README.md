# 中文 PDF 回归夹具（1.7.4）

| 文件 | 内容 | 期望 |
|---|---|---|
| `vector-pdf-30-a/b.pdf` | Windows 评测的原始文件：30 页，中文用不嵌入的“Heiti”（编码 UniGB-UTF16-H），第 7、14、21、28 页金额和期限有改动 | 富文本 8 处差异；图像第 7/14/21/28 页有差异，其余相同 |
| `cn-mix-A/B.pdf` | 正文嵌入文泉驿正黑；金额、期限、服务期限三行用不嵌入的 STSong-Light（UniGB-UCS2-H） | 三行的改动都能发现，没有读取警告 |
| `cn-mix-A2.pdf` | 与 `cn-mix-A.pdf` 内容相同 | A 对 A2：0 处差异、没有误报 |
| `cn-embed-A/B.pdf` | 全部嵌入字体、同样的改动（对照组） | 与 cn-mix 结果一致 |
| `cn-badcmap-A/B.pdf` | 把 cn-mix 的 CMap 名改成不存在的 `UniGB-UCSX-H`，模拟字体无法解析 | 出现“有些文字没能读出来”的警告，比较范围里列出未比较的页，图像页标“可能缺字” |

`make-cjk-fixtures.py` 生成 cn-mix / cn-embed（需要 reportlab 和文泉驿正黑字体）；cn-badcmap 由 cn-mix 替换 CMap 名得到。
