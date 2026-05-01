# JLPT 翻译整卷精校工作日志

> 主日志改为精简版，只保留口径、当前进度和最近续做位置。
> 2026-04-30 之前的长版明细已归档到 `data/paper/jlpt/jlpt_translation_polish_worklog.archive.2026-04-30.md`。

## 口径

- 范围：`data/system/translations/jlpt/`
- 标准：整卷人工精校 + 二校，目标为出版物级可读性
- 验收基线：
  - `updated_by = human-polish`
  - `mt/legacy = 0`
  - `missing = 0`
  - `wrongOptionNumber = 0`
  - `bad = 0`
  - `mojibake = 0`
- 说明：
  - `latinResidual` 允许保留题目固有表记，如 `DVD`、邮件地址、专名字母缩写等
  - 旧的 `99.9` 词汇语法进度不等于当前整卷翻译已收口

## 当前进度

- `N1`：已连续收口至 `N1_2025_07.json`
- `N2`：已连续收口至 `N2_2025_07.json`
- `N3`：已连续收口至 `N3_2024_12.json`
- `N3` 待源模板：`N3_2025_07.json`、`N3_2025_12.json`
- 当前下一份：`N3` 暂无可实做新卷；待补 `2025_07 / 2025_12` 实际题面源数据

## 最近完成

### N3_2015_12

- 文件：`data/system/translations/jlpt/n3/N3_2015_12.json`
- 结果：
  - `total=464`
  - `human=464`
  - `mt/legacy=0`
  - `bad=0`
  - `mojibake=0`
  - `missing=0`
  - `wrongOptionNumber=0`
  - `latinResidual=14`（题目固有 `A`、`B`、`CD`、`DVD`）
  - 坏味道扫描：`found=0`

### N3_2016_07

- 文件：`data/system/translations/jlpt/n3/N3_2016_07.json`
- 本轮重点：
  - 重做 `1.01 - 1.07`
  - 收口 `1.08 - 1.12` 高风险问项
  - 重做 `2.01 - 2.05` 听力题干、选项与脚本
- 结果：
  - `total=755`
  - `human=755`
  - `mt/legacy=0`
  - `bad=0`
  - `mojibake=0`
  - `missing=0`
  - `wrongOptionNumber=0`
  - `latinResidual=5`（题目固有 `DVD`、`OK`）
  - 坏味道扫描：`found=0`

### N3_2016_12

- 文件：`data/system/translations/jlpt/n3/N3_2016_12.json`
- 本轮重点：
  - 重做 `1.01 - 1.07` 的读音、表记、词汇、语义、用法、语法与排序题
  - 收口 `1.08 - 1.12` 的问项、选项和高风险篇章译文
  - 重做 `2.01 - 2.05` 的听力题干、选项与脚本
  - 清理 passage 旧碎片、专名误写和机翻残句
- 结果：
  - `total=761`
  - `human=761`
  - `mt/legacy=0`
  - `bad=0`
  - `mojibake=0`
  - `missing=0`
  - `wrongOptionNumber=0`
  - `latinResidual=4`（题目固有 `ABC`、`DVD`、邮件地址、公司字母名）
  - 坏味道扫描：`found=0`
- 备注：
  - 主日志已瘦身，旧明细见归档文件
  - 下一步按文件名顺序继续 `N3_2017_07.json`

### N3_2017_07

- 文件：`data/system/translations/jlpt/n3/N3_2017_07.json`
- 本轮重点：
  - 重做 `1.01 - 1.07` 的题干、词项与语法题译文
  - 收口 `1.08 - 1.12` 的篇章、问项、选项与高风险专名
  - 重做 `2.01 - 2.05` 的听力选项与整段脚本
  - 清理整卷机翻残句、问句硬译和专名误写
- 结果：
  - `total=819`
  - `human=819`
  - `mt/legacy=0`
  - `bad=0`
  - `mojibake=0`
  - `missing=0`
  - `wrongOptionNumber=0`
  - `latinResidual=3`（题目固有邮件地址、Mike、OK）
  - 坏味道扫描：`found=0`
- 备注：
  - 下一步按文件名顺序继续 `N3_2017_12.json`


### N3_2017_12

- 文件：`data/system/translations/jlpt/n3/N3_2017_12.json`
- 本轮重点：
  - 重做 `1.01 - 1.07` 的题干、词项与语法题译文
  - 收口 `1.08 - 1.12` 的篇章、问项、选项与高风险专名
  - 重做 `2.01 - 2.05` 的听力选项与整段脚本
  - 清理整卷机翻残句、问句硬译和篇章碎裂
- 结果：
  - `total=748`
  - `human=748`
  - `mt/legacy=0`
  - `bad=0`
  - `mojibake=0`
  - `missing=0`
  - `wrongOptionNumber=0`
  - `latinResidual=1`（题目固有 `K市`）
  - 坏味道扫描：`found=0`
- 备注：
  - 下一步按文件名顺序继续 `N3_2018_07.json`


### N3_2018_07

- 文件：`data/system/translations/jlpt/n3/N3_2018_07.json`
- 本轮重点：
  - 重做 `1.01 - 1.07` 的题干、词项与语法题译文
  - 收口 `1.08 - 1.12` 的篇章、问项、选项与高风险专名
  - 重做 `2.01 - 2.05` 的听力选项与整段脚本
  - 清理整卷机翻残句、问句硬译与听力叙述别扭处
- 结果：
  - `total=804`
  - `human=804`
  - `mt/legacy=0`
  - `bad=0`
  - `mojibake=0`
  - `missing=0`
  - `wrongOptionNumber=0`
  - `latinResidual=1`（题面固有邮箱地址）
  - 坏味道扫描：`found=0`
- 备注：
  - 下一步按文件名顺序继续 `N3_2018_12.json`


### N3_2018_12

- 文件：`data/system/translations/jlpt/n3/N3_2018_12.json`
- 本轮重点：
  - 重做 `1.01 - 1.07` 的题干、词项与语法题译文
  - 收口 `1.08 - 1.12` 的篇章、问项、选项与高风险专名
  - 重做 `2.01 - 2.05` 的听力选项与整段脚本
  - 清理整卷机翻残句、硬译问句与听力口气失真
- 结果：
  - `total=847`
  - `human=847`
  - `mt/legacy=0`
  - `bad=0`
  - `mojibake=0`
  - `missing=0`
  - `wrongOptionNumber=0`
  - `latinResidual=1`（题面固有 `DVD`）
  - 坏味道扫描：`found=0`
- 备注：
  - 下一步按文件名顺序继续 `N3_2019_07.json`


### N3_2019_07

- 文件：`data/system/translations/jlpt/n3/N3_2019_07.json`
- 本轮重点：
  - 重做 `1.01 - 1.07` 的题干、词项与语法题译文
  - 收口 `1.08 - 1.12` 的篇章、问项、选项与高风险专名
  - 重做 `2.01 - 2.05` 的听力选项与整段脚本
  - 清理整卷机翻残句、硬译问句与听力语气失真
- 结果：
  - `total=721`
  - `human=721`
  - `mt/legacy=0`
  - `bad=0`
  - `mojibake=0`
  - `missing=0`
  - `wrongOptionNumber=0`
  - `latinResidual=1`（题面固有邮箱地址）
  - 坏味道扫描：`found=0`
- 备注：
  - 下一步按文件名顺序继续 `N3_2019_12.json`


### N3_2019_12

- 文件：`data/system/translations/jlpt/n3/N3_2019_12.json`
- 本轮重点：
  - 重做 `1.01 - 1.07` 的题干、词项与语法题译文
  - 收口 `1.08 - 1.12` 的篇章、问项、选项与高风险专名
  - 重做 `2.01 - 2.05` 的听力选项与整段脚本
  - 清理整卷机翻残句、硬译问句与听力语气失真
- 结果：
  - `total=759`
  - `human=759`
  - `mt/legacy=0`
  - `bad=0`
  - `mojibake=0`
  - `missing=0`
  - `wrongOptionNumber=0`
  - `latinResidual=5`（题面固有 `A/B`、`T`、`OK`）
  - 坏味道扫描：`found=0`
- 备注：
  - `N3_2020_07.json` 当前仍是 `90` 字节占位文件，暂无整卷可精校内容，续做时顺延至 `N3_2020_12.json`


### N3_2020_12

- 文件：`data/system/translations/jlpt/n3/N3_2020_12.json`
- 本轮重点：
  - 重做 `1.01 - 1.07` 的题干、词项与语法题译文
  - 收口 `1.08 - 1.12` 的篇章、问项、选项与高风险专名
  - 重做 `2.04 - 2.05` 的口语听力与应答项
  - 清理整卷机翻残句、硬译问句、错别字与分句错位
- 结果：
  - `total=735`
  - `human=735`
  - `mt/legacy=0`
  - `bad=0`
  - `mojibake=0`
  - `missing=0`
  - `wrongOptionNumber=0`
  - `latinResidual=19`（题面固有 `A`、`B`、`S市`、`OK`、`mottainai`、`卡拉OK` 等）
  - 坏味道扫描：`found=0`
- 备注：
  - 下一步按文件名顺序继续 `N3_2021_07.json`


### N3_2021_07

- 文件：`data/system/translations/jlpt/n3/N3_2021_07.json`
- 本轮重点：
  - 重做 `1.08 - 1.11` 的篇章、问项与高风险段落译文
  - 收口 `1.01 - 1.07` 的题干与易错选项
  - 重做 `2.04 - 2.05` 的口语听力与应答项
  - 清理整卷机翻残句、硬译问句与明显错译
- 结果：
  - `total=713`
  - `human=713`
  - `mt/legacy=0`
  - `bad=0`
  - `mojibake=0`
  - `missing=0`
  - `wrongOptionNumber=0`
  - `latinResidual=18`（题面固有 `A/B`、`X`、`CM`、邮件地址、专名与排序占位等）
  - 坏味道扫描：`found=0`
- 备注：
  - 下一步按文件名顺序继续 `N3_2021_12.json`


### N3_2021_12

- 文件：`data/system/translations/jlpt/n3/N3_2021_12.json`
- 本轮重点：
  - 重做 `1.08 - 1.11` 的篇章、问项与高风险段落译文
  - 收口 `1.01 - 1.07` 的题干与易错选项
  - 重做 `2.04 - 2.05` 的口语听力与应答项
  - 清理整卷机翻残句、硬译问句与明显错译
- 结果：
  - `total=729`
  - `human=729`
  - `mt/legacy=0`
  - `bad=0`
  - `mojibake=0`
  - `missing=0`
  - `wrongOptionNumber=0`
  - `latinResidual=5`（题面固有 `Dokidoki`、`ABC`、`A/B`、`Kou`）
  - 坏味道扫描：`found=0`
- 备注：
  - 下一步按文件名顺序继续 `N3_2022_07.json`


### N3_2022_07

- 文件：`data/system/translations/jlpt/n3/N3_2022_07.json`
- 本轮重点：
  - 重做 `1.01 - 1.07` 的题干、选项与语法表达
  - 收口 `1.08 - 1.11` 的篇章、问项与高风险段落译文
  - 重做 `2.01 - 2.05` 的听力题干、脚本与应答项
  - 清理整卷机翻残句、错词错义与不自然口气
- 结果：
  - `total=703`
  - `human=703`
  - `mt/legacy=0`
  - `bad=0`
  - `mojibake=0`
  - `missing=0`
  - `wrongOptionNumber=0`
  - `latinResidual=2`（题面固有 `A/B` 对话标记、`T恤`）
  - 坏味道扫描：`found=0`
- 备注：
  - 下一步按文件名顺序继续 `N3_2022_12.json`


### N3_2022_12

- 文件：`data/system/translations/jlpt/n3/N3_2022_12.json`
- 本轮重点：
  - 重做 `1.01 - 1.07` 的题干、选项与语法表达
  - 收口 `1.08 - 1.11` 的篇章、问项与高风险段落译文
  - 重做 `2.01 - 2.05` 的听力题干、脚本与应答项
  - 清理整卷机翻残句、错词错义与不自然口气
- 结果：
  - `total=714`
  - `human=714`
  - `mt/legacy=0`
  - `bad=0`
  - `mojibake=0`
  - `missing=0`
  - `wrongOptionNumber=0`
  - `latinResidual=9`（题面固有 `A/B` 对话标记、`ABC`、元音字母选项等）
  - 坏味道扫描：`found=0`
- 备注：
  - 下一步按文件名顺序继续 `N3_2023_07.json`


### N3_2023_07

- 文件：`data/system/translations/jlpt/n3/N3_2023_07.json`
- 本轮重点：
  - 重做 `1.01 - 1.07` 的题干、词项、语法题与排序句表达
  - 收口 `1.08 - 1.11` 的篇章、问项与高风险细节翻译
  - 重做 `2.01 - 2.05` 的听力脚本、题干与应答项
  - 清理整卷机翻残句、错词错义、编号异常与语气失真
- 结果：
  - `total=464`
  - `human=464`
  - `mt/legacy=0`
  - `bad=0`
  - `mojibake=0`
  - `missing=0`
  - `wrongOptionNumber=0`
  - `latinResidual=0`
  - 坏味道扫描：`found=0`
- 备注：
  - 原文件中 `1.12:p1:q72` 缺失独立 `option4` 节点，已在本轮补齐并标准化为四选项结构
  - 下一步按文件名顺序继续 `N3_2023_12.json`


### N3_2023_12

- 文件：`data/system/translations/jlpt/n3/N3_2023_12.json`
- 本轮重点：
  - 重做 `1.01 - 1.07` 的题干、词项、语法题与排序句表达
  - 收口 `1.08 - 1.11` 的篇章、问项与高风险细节翻译
  - 重做 `2.01 - 2.05` 的听力脚本、题干与应答项
  - 清理整卷机翻残句、错词错义与语气失真
- 结果：
  - `total=464`
  - `human=464`
  - `mt/legacy=0`
  - `bad=0`
  - `mojibake=0`
  - `missing=0`
  - `wrongOptionNumber=0`
  - `latinResidual=0`
  - 坏味道扫描：`found=0`
- 备注：
  - 下一步按文件名顺序继续 `N3_2024_07.json`


### N3_2024_07

- 文件：`data/system/translations/jlpt/n3/N3_2024_07.json`
- 本轮重点：
  - 重做 `1.01 - 1.07` 的题干、词项、语法题与排序句表达
  - 收口 `1.08 - 1.11` 的篇章、问项与高风险细节翻译
  - 重做 `2.01 - 2.05` 的听力脚本、题干与应答项
  - 清理整卷机翻残句、错词错义与语气失真
- 结果：
  - `total=464`
  - `human=464`
  - `mt/legacy=0`
  - `bad=0`
  - `mojibake=0`
  - `missing=0`
  - `wrongOptionNumber=0`
  - `latinResidual=0`
  - 坏味道扫描：`found=0`
- 备注：
  - 下一步按文件名顺序继续 `N3_2024_12.json`


### N3_2024_12

- 文件：`data/system/translations/jlpt/n3/N3_2024_12.json`
- 本轮重点：
  - 重做 `1.01 - 1.07` 的题干、词项、语法题与排序句表达
  - 收口 `1.08 - 1.11` 的篇章、问项与高风险细节翻译
  - 重做 `2.01 - 2.05` 的听力脚本、题干与应答项
  - 清理整卷机翻残句、错词错义与语气失真
- 结果：
  - `total=704`
  - `human=704`
  - `mt/legacy=0`
  - `bad=0`
  - `mojibake=0`
  - `missing=0`
  - `wrongOptionNumber=0`
  - `latinResidual=15`（题目固有 `A`、`B`、`K`、`T`、`ABC`）
  - 坏味道扫描：`found=0`
- 备注：
  - 下一步按文件名顺序继续 `N3_2025_07.json`


### N3_2025_07

- 文件：`data/system/translations/jlpt/n3/N3_2025_07.json`
- 当前状态：
  - 源文件 `data/paper/jlpt/n3/N3_2025_07.json` 现为 template，占位结构为 `exam_info.sections = []`
  - 翻译文件 `data/system/translations/jlpt/n3/N3_2025_07.json` 当前也为空壳，`items = {}`
  - 仓库内仅有参考答案页与答案图：`downloads/jlpt_missing_sources/N3_2025_07_answers_page.html`、`N3_2025_07_answers.png`
- 结论：
  - 由于缺少完整题面源数据，本轮不能按“整卷人工精校 + 二校”实际收口，也不能伪造整卷翻译内容
  - `N3_2025_12.json` 同样为 template 占位卷；当前 N3 可实做卷已全部做到 `N3_2024_12.json`
- 备注：
  - 后续待补 `2025_07 / 2025_12` 的实际题面 JSON 或等价完整源稿后，再恢复 N3 顺推
