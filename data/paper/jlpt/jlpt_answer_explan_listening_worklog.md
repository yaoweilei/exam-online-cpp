# JLPT 听力题 Check 工作日志

## 1. 用途

- 本文件只记录 JLPT 听力区 `2.01-2.05` 的 check、返修、验收与优先队列。
- 词汇语法、阅读与整卷总账仍按原记录体系维护；听力逐卷明细不再继续堆入过长的总 worklog。
- 当前成品标准以 `data/paper/jlpt/jlpt_answer_explan_standard.md` 为唯一准绳。

## 2. 当前听力统一标准

### 2.1 固定标题

`explanation`

- `【题目解析】`
- `【为什么选X】`
- `【误选项为什么错】`
- `【拿分提醒】`

`explanation_expand`

- `【补充解析】`
- `【实战方法】`
- `【关键表达】`
- `【听力原文与翻译】`

### 2.2 听力特别要求

- 必须写清本题在听什么，不能只写“考原因 / 考决定”四个字。
- 必须指出答案落在哪个转折点、变化点或最后定案句。
- 必须写清“前面提过但未定 / 后面才定案”的信息流变化。
- 必须逐项说明误听或误选来源，不能只写空泛排除句。
- `【听力原文与翻译】` 只放在补充层，不能代替主解析的信息流分析。

## 3. 记账口径

- 本文件的“完成 / 验收 / 99.9”只针对听力区，不外推到词汇语法、阅读或整卷。
- 若某次只处理局部题段，必须写清精确范围，如 `2.01-1` 至 `2.01-6`。
- “机械归零”只认当前 JSON 里最终落地的 `explanation` 与 `explanation_expand` 成品文本。
- 听力区达标的最低条件：JSON 解析正常、标题符合当前听力 `4+4`、旧稿残留归零、转折点 / 定案句分析到位。
- 若中途发生 patch 漂移，先恢复受污染对象，再继续同范围返修与窄校验。

## 4. N1 听力启动基线

- 日期：`2026-04-16`
- 范围：`data/paper/jlpt/n1/*.json` 的听力区 `2.01-2.05`
- 当前非空卷数：`30`
- 当前总题量：`1041`
- 基线扫描结果：按当前听力出版物 `4+4` 标题与旧稿残留口径复扫，`30 / 30` 套命中问题，当前尚无一套可直接按听力出版物口径验收。
- 推进顺序：先按年份顺推，从 `N1_2010_07` 起；若某卷复核后已接近达标，可在本文件里注明后调整队列。

### N1_2010_07

- 文件：`data/paper/jlpt/n1/N1_2010_07.json`
- 起手基线：听力区 `2.01-2.05` 共 `37` 题；按当前听力出版物 `4+4` 口径机械扫描，起手 `issues=37`。
- 已确认：
  - 听力区结构完整，范围为 `2.01-2.05`。
  - 当前并非空模板，但尚未统一到听力专用 `4+4` 成品口径。
- 本轮覆盖：
  - 已完成 `2.01-1` 至 `2.01-6` 的 explanation / explanation_expand 重写。
  - 六题均已统一到当前听力专用 `4+4` 标题体系。
  - 已完成 `2.02-1` 至 `2.02-7` 的 explanation / explanation_expand 重写。
  - 七题均已统一到当前听力专用 `4+4` 标题体系。
  - 已完成 `2.03-1` 至 `2.03-6` 的 explanation / explanation_expand 重写。
  - 六题均已统一到当前听力专用 `4+4` 标题体系。
  - 已完成 `2.04-1` 至 `2.04-14` 的 explanation / explanation_expand 重写。
  - 十四题均已统一到当前听力专用 `4+4` 标题体系。
  - 已完成 `2.05` 两个 passage、四道题的 explanation / explanation_expand 重写。
  - 四题均已统一到当前听力专用 `4+4` 标题体系。
- 本轮结果：
  - `2.01-1` 至 `2.01-6` 通过 JSON 解析。
  - `2.01` 整段终检通过：`QCOUNT=6 / ISSUES=0`。
  - `2.02-1` 至 `2.02-7` 通过 JSON 解析。
  - `2.02` 整段终检通过：`QCOUNT=7 / ISSUES=0`。
  - `2.03-1` 至 `2.03-6` 通过 JSON 解析。
  - `2.03` 整段终检通过：`QCOUNT=6 / ISSUES=0`。
  - `2.04-1` 至 `2.04-14` 通过 JSON 解析。
  - `2.04` 整段终检通过：`QCOUNT=14 / ISSUES=0`。
  - `2.05` 两个 passage、四道题通过 JSON 解析。
  - `2.05` 整段终检通过：`QCOUNT=4 / ISSUES=0`。
  - `N1_2010_07` 听力整卷总检通过：`RANGE=2.01-2.05 / QCOUNT=37 / ISSUES=0`。
  - 结构备注：`2.05 / passage 1 / question 2` 当前 JSON 未独立落完整 script；本轮沿用旧解析中已保留的关键原句完成 `【听力原文与翻译】` 收口，若后续需要逐句 transcript 回填，需另行回源音频复核。
- 下一步：
  - 记录本卷已完成整卷听力出版物口径收口。
  - 按年份顺推进入下一套 `N1` 听力卷。
  - 每批改后立刻回跑 JSON 校验与同范围窄校验。

### N1_2010_12

- 文件：`data/paper/jlpt/n1/N1_2010_12.json`
- 起手基线：听力区 `2.01-2.05` 共 `36` 题；按当前听力出版物 `4+4` 口径逐段复扫，起手 `issues=36`。
- 已确认：
  - 听力区结构完整，范围为 `2.01-2.05`。
  - `2.01-2.05` 各题原有 explanation / explanation_expand 仍停留在旧模板，需整段统一重写。
  - `2.05 / passage 1` 当前 JSON 挂载的 `script` 与题干不对应；题干为“给母亲买礼物”，但 `script` 实际是“挑新产品设计师”的另一题内容。
- 本轮覆盖：
  - 已完成 `2.01-1` 至 `2.01-6` 的 explanation / explanation_expand 重写。
  - 已完成 `2.02-1` 至 `2.02-7` 的 explanation / explanation_expand 重写。
  - 已完成 `2.03-1` 至 `2.03-5` 的 explanation / explanation_expand 重写。
  - 已完成 `2.04-1` 至 `2.04-14` 的 explanation / explanation_expand 重写。
  - 已完成 `2.05` 两个 passage、四道题的 explanation / explanation_expand 重写。
- 本轮结果：
  - `2.01` 整段终检通过：`QCOUNT=6 / ISSUES=0`。
  - `2.02` 整段终检通过：`QCOUNT=7 / ISSUES=0`。
  - `2.03` 整段终检通过：`QCOUNT=5 / ISSUES=0`。
  - `2.04` 整段终检通过：`QCOUNT=14 / ISSUES=0`。
  - `2.05` 整段终检通过：`QCOUNT=4 / ISSUES=0`。
  - `N1_2010_12` 听力整卷总检通过：`RANGE=2.01-2.05 / QCOUNT=36 / ISSUES=0`。
  - 结构备注：`2.05 / passage 1` 的 `script` 当前仍是错挂数据；本轮通过外部对照 PDF 提纲与旧解析保留关键原句，完成两问 explanation / explanation_expand 的出版物口径收口，但若后续需要逐句 transcript 或脚本字段回填，仍需回源音频复核并更正该 `script` 块本体。
- 下一步：
  - 记录本卷已完成整卷听力出版物口径收口。
  - 按年份顺推进入下一套 `N1` 听力卷。
  - 若继续处理 `2.05 / passage 1` 相关衍生功能，优先先修复错挂 `script`，再谈 transcript 逐句化。

### N1_2011_07

- 文件：`data/paper/jlpt/n1/N1_2011_07.json`
- 起手基线：听力区 `2.01-2.05` 共 `36` 题；按当前听力出版物 `4+4` 口径复扫，起手 `issues=36`。
- 已确认：
  - 听力区结构完整，范围为 `2.01-2.05`。
  - 初次返修 `2.01` 时曾发生 patch 漂移，污染到 `2.02-2.04` 的 explanation / explanation_expand，且局部 script item 被串入异题 explanation。
  - 已先恢复目标 JSON 到干净状态，再按 section 级重建受影响题段，避免继续叠加漂移修补。
- 本轮覆盖：
  - 已完成 `2.01-1` 至 `2.01-6` 的 explanation / explanation_expand 重写。
  - 已完成 `2.02-1` 至 `2.02-7` 的 explanation / explanation_expand 重写。
  - 已完成 `2.03-1` 至 `2.03-6` 的 explanation / explanation_expand 重写，并修复 `Q3 / Q6` 被串入 explanation 的 script item。
  - 已完成 `2.04-1` 至 `2.04-13` 的 explanation / explanation_expand 重写。
  - 已完成 `2.05` 两个 passage、四道题的 explanation / explanation_expand 重写。
- 本轮结果：
  - `2.01` 整段终检通过：`QCOUNT=6 / ISSUES=0`。
  - `2.02` 整段终检通过：`QCOUNT=7 / ISSUES=0`。
  - `2.03` 整段终检通过：`QCOUNT=6 / ISSUES=0`。
  - `2.04` 整段终检通过：`QCOUNT=13 / ISSUES=0`。
  - `2.05` 整段终检通过：`QCOUNT=4 / ISSUES=0`。
  - `N1_2011_07` 听力整卷总检通过：`RANGE=2.01-2.05 / QCOUNT=36 / ISSUES=0`。
  - 结构备注：本轮中途出现的 section 串题污染已全部清除；最终 JSON 复验正常，`2.01-2.05` 已全部回到当前听力出版物 `4+4` 成品口径。
- 下一步：
  - 记录本卷已完成整卷听力出版物口径收口。
  - 按年份顺推进入下一套 `N1` 听力卷。
  - 若后续再遇到同类重复文本 patch 漂移，优先采用 section 级重建与同节窄校验，不再做跨题块叠加修补。

### N1_2011_12

- 文件：`data/paper/jlpt/n1/N1_2011_12.json`
- 起手基线：听力区 `2.01-2.05` 共 `36` 题；按当前听力出版物 `4+4` 口径复扫，起手 `issues=36`。
- 已确认：
  - 听力区结构完整，范围为 `2.01-2.05`。
  - `2.01-2.04` 各题原有 explanation / explanation_expand 仍停留在旧模板，需整段统一重写。
  - `2.05 / passage 1` 当前 JSON 仅保留了第一小题的可见问句脚本与题面选项，第二小题仍挂着串稿 explanation，且 question / options 未正确落地；需回源同一 mp3 的后半段重新确认题干与选项。
- 本轮覆盖：
  - 已完成 `2.01-1` 至 `2.01-6` 的 explanation / explanation_expand 重写。
  - 已完成 `2.02-1` 至 `2.02-7` 的 explanation / explanation_expand 重写。
  - 已完成 `2.03-1` 至 `2.03-6` 的 explanation / explanation_expand 重写。
  - 已完成 `2.04-1` 至 `2.04-13` 的 explanation / explanation_expand 重写。
  - 已完成 `2.05` 两个 passage、四道题的 explanation / explanation_expand 重写。
  - 已将 `2.05 / passage 1 / question 1` 的选项恢复为实际运输方案；已将 `question 2` 回填为“毕业研究如何修正”的题面选项，并按音频后半段重建 explanation / explanation_expand。
- 本轮结果：
  - `2.01` 整段终检通过：`QCOUNT=6 / ISSUES=0`。
  - `2.02` 整段终检通过：`QCOUNT=7 / ISSUES=0`。
  - `2.03` 整段终检通过：`QCOUNT=6 / ISSUES=0`。
  - `2.04` 整段终检通过：`QCOUNT=13 / ISSUES=0`。
  - `2.05` 整段终检通过：`QCOUNT=4 / ISSUES=0`。
  - `N1_2011_12` 听力整卷总检通过：`RANGE=2.01-2.05 / QCOUNT=36 / ISSUES=0`。
  - 结构备注：`2.05 / passage 1` 当前 script block 仍只挂到第一小题；本轮通过同一 mp3 后半段的本地音频复核，恢复了第二小题的题面主线与选项，但若后续需要逐句 transcript / timestamp 回填，仍需继续回源音频补全 script 本体。
- 下一步：
  - 记录本卷已完成整卷听力出版物口径收口。
  - 按年份顺推进入下一套 `N1` 听力卷。
  - 若后续再遇到同一 mp3 内含两小题但 JSON 只保留前半段 script 的情况，优先先回源音频确认后半段问句 / 选项，再继续 explanation 收口。

### N1_2012_07

- 文件：`data/paper/jlpt/n1/N1_2012_07.json`
- 起手基线：听力区 `2.01-2.05` 机械复扫起手为 `QCOUNT=36 / ISSUES=36`；其中 `2.05 / passage 1` 当前 JSON 挂了两个 question object，但 passage 提示语实际是单数 `質問と選択肢を聞いて`。
- 已确认：
  - 听力区范围为 `2.01-2.05`，`2.01-2.04` 各题 explanation / explanation_expand 仍停留在旧模板，需整段统一重写。
  - `2.05 / passage 1` 的 script 与题尾问句只支持一道小题；原 JSON 第二个 question object 为结构性幽灵题，不能为了维持旧总数而保留。
- 本轮覆盖：
  - 已完成 `2.01-1` 至 `2.01-6` 的 explanation / explanation_expand 重写。
  - 已完成 `2.02-1` 至 `2.02-7` 的 explanation / explanation_expand 重写。
  - 已完成 `2.03-1` 至 `2.03-6` 的 explanation / explanation_expand 重写。
  - 已完成 `2.04-1` 至 `2.04-13` 的 explanation / explanation_expand 重写。
  - 已完成 `2.05` 三道真实题的 explanation / explanation_expand 重写。
  - 已将 `2.05 / passage 1 / question 1` 的选项恢复为实际犬只颜色，并删除多挂的第二个 ghost question object。
- 本轮结果：
  - `2.01` 整段终检通过：`QCOUNT=6 / ISSUES=0`。
  - `2.02` 整段终检通过：`QCOUNT=7 / ISSUES=0`。
  - `2.03` 整段终检通过：`QCOUNT=6 / ISSUES=0`。
  - `2.04` 整段终检通过：`QCOUNT=13 / ISSUES=0`。
  - `2.05` 整段终检通过：`QCOUNT=3 / ISSUES=0`。
  - `N1_2012_07` 听力整卷总检通过：`RANGE=2.01-2.05 / QCOUNT=35 / ISSUES=0`。
  - 结构备注：本卷 `2.05` 的真实结构为 `passage 1 = 1` 题、`passage 2 = 2` 题；起手 `QCOUNT=36` 来自旧 JSON 中多挂的幽灵题，本轮已按音频脚本结构修正为真实 `35` 题。
- 下一步：
  - 记录本卷已完成整卷听力出版物口径收口。
  - 按年份顺推进入下一套 `N1` 听力卷。
  - 若后续再遇到 `2.05` 题量异常，先核对 passage 提示语中的单复数和题尾问句数量，再决定是补题还是删 ghost object。

### N1_2014_12

- 文件：`data/paper/jlpt/n1/N1_2014_12.json`
- 起手基线：听力区 `2.01-2.05` 共 `37` 题；按当前听力出版物 `4+4` 口径复扫，起手 `issues=37`。
- 已确认：
  - 听力区结构完整，范围为 `2.01-2.05`。
  - `2.01-2.05` 各题 explanation / explanation_expand 仍有旧占位，需整段统一重写。
- 本轮覆盖：
  - 已完成 `2.01-1` 至 `2.01-6` 的 explanation / explanation_expand 重写。
  - 已完成 `2.02-1` 至 `2.02-7` 的 explanation / explanation_expand 重写。
  - 已完成 `2.03-1` 至 `2.03-6` 的 explanation / explanation_expand 重写。
  - 已完成 `2.04-1` 至 `2.04-14` 的 explanation / explanation_expand 重写。
  - 已完成 `2.05` 两个 passage、四道题的 explanation / explanation_expand 重写。
- 本轮结果：
  - `2.01` 整段终检通过：`QCOUNT=6 / ISSUES=0`。
  - `2.02` 整段终检通过：`QCOUNT=7 / ISSUES=0`。
  - `2.03` 整段终检通过：`QCOUNT=6 / ISSUES=0`。
  - `2.04` 整段终检通过：`QCOUNT=14 / ISSUES=0`。
  - `2.05` 整段终检通过：`QCOUNT=4 / ISSUES=0`。
  - `N1_2014_12` 听力整卷总检通过：`RANGE=2.01-2.05 / QCOUNT=37 / ISSUES=0`。
  - 当前 JSON 解析正常，听力区占位符 `⚠️` 已归零。
- 下一步：
  - 记录本卷已完成整卷听力出版物口径收口。
  - 按年份顺推进入下一套 `N1` 听力卷。
  - 如需达到更高人工审校标准，可在下一轮对 `2.03-2.05` 的信息流与误选项针对性做逐题精修。

### N1_2014_12（深度精修补记）

- 文件：`data/paper/jlpt/n1/N1_2014_12.json`
- 补记背景：在整卷 `ISSUES=0` 后，按“出版物级深度精修”要求对听力后半段进行二次强化。
- 本轮覆盖：
  - 已对 `2.03-1` 至 `2.03-6` 重写为“按题落证据”的主旨解析，补齐主旨句与误选触发点。
  - 已对 `2.04-1` 至 `2.04-14` 重写为“前句语用类型 + 应答方向”口径，逐题绑定接话逻辑。
  - 已对 `2.05` 四题补强“条件筛选/双人立场/定案句”链路，修正同段不同问法的落点区分。
- 本轮结果：
  - `2.03` 终检：`QCOUNT=6 / ISSUES=0`。
  - `2.04` 终检：`QCOUNT=14 / ISSUES=0`。
  - `2.05` 终检：`QCOUNT=4 / ISSUES=0`。
  - JSON 解析正常；深度精修后占位符 `⚠️` 维持归零。

### N1_2015_07

- 文件：`data/paper/jlpt/n1/N1_2015_07.json`
- 起手基线：听力区 `2.01-2.05` 共 `37` 题；起手 `issues=37`（全题仍为占位解析）。
- 已确认：
  - 听力区结构完整，范围为 `2.01-2.05`。
  - `2.03` 与 `2.04` 的 `options` 字段为占位编号，需回收脚本中的题尾选项信息做解析落点。
- 本轮覆盖：
  - 已完成 `2.01-1` 至 `2.01-6` explanation / explanation_expand 重写。
  - 已完成 `2.02-1` 至 `2.02-7` explanation / explanation_expand 重写。
  - 已完成 `2.03-1` 至 `2.03-6` explanation / explanation_expand 重写。
  - 已完成 `2.04-1` 至 `2.04-14` explanation / explanation_expand 重写。
  - 已完成 `2.05` 两个 passage、四道题 explanation / explanation_expand 重写。
- 本轮结果：
  - `2.01` 整段终检通过：`QCOUNT=6 / ISSUES=0`。
  - `2.02` 整段终检通过：`QCOUNT=7 / ISSUES=0`。
  - `2.03` 整段终检通过：`QCOUNT=6 / ISSUES=0`。
  - `2.04` 整段终检通过：`QCOUNT=14 / ISSUES=0`。
  - `2.05` 整段终检通过：`QCOUNT=4 / ISSUES=0`。
  - `N1_2015_07` 听力整卷总检通过：`RANGE=2.01-2.05 / QCOUNT=37 / ISSUES=0`。
  - JSON 解析正常，听力区占位符 `⚠️` 已归零。

### N1_2015_12

- 文件：`data/paper/jlpt/n1/N1_2015_12.json`
- 起手基线：听力区 `2.01-2.05` 共 `37` 题；起手 `issues=36`（`2.01` 仅 1 题非占位，其他题均为占位解析）。
- 已确认：
  - 听力区结构完整，范围为 `2.01-2.05`。
  - `2.03` 的 `options` 字段为占位编号，需回收 script 题尾选项做主旨题落点。
  - `2.05 / passage 1` 当前 script 仅保留第一问题尾（店铺选择），第二问题尾在源数据中缺失。
- 本轮覆盖：
  - 已完成 `2.01-1` 至 `2.01-6` explanation / explanation_expand 逐题重写。
  - 已完成 `2.02-1` 至 `2.02-7` explanation / explanation_expand 逐题重写。
  - 已完成 `2.03-1` 至 `2.03-6` explanation / explanation_expand 逐题重写（并按 script 回填选项语义）。
  - 已完成 `2.04-1` 至 `2.04-14` explanation / explanation_expand 逐题重写。
  - 已完成 `2.05` 两个 passage、四道题 explanation / explanation_expand 逐题重写。
- 本轮结果：
  - `2.01` 整段终检通过：`QCOUNT=6 / ISSUES=0`。
  - `2.02` 整段终检通过：`QCOUNT=7 / ISSUES=0`。
  - `2.03` 整段终检通过：`QCOUNT=6 / ISSUES=0`。
  - `2.04` 整段终检通过：`QCOUNT=14 / ISSUES=0`。
  - `2.05` 整段终检通过：`QCOUNT=4 / ISSUES=0`。
  - `N1_2015_12` 听力整卷总检通过：`RANGE=2.01-2.05 / QCOUNT=37 / ISSUES=0`。
  - 标题规范复核通过：`4+4` 标题全量命中；旧标题与流程信号（`【问题翻译】/【判断方法】/【正确答案】/【判断口诀】/正确答案：/句意：/答案是`）归零。
  - JSON 解析正常，听力区占位符 `⚠️` 已归零。
- 结构备注：
  - `2.05 / passage 1 / question 2` 题尾缺失问题仍存在。本轮按“可证据化最小闭环”写法保留该题，并在解析内显式标注需回源音频/原卷补齐题尾后再做最终逐项误选版。

### N1_2016_07

- 文件：`data/paper/jlpt/n1/N1_2016_07.json`
- 起手基线：听力区 `2.01-2.05` 共 `37` 题；起手 `issues=34`（`2.03` 有 3 题为旧稿、其余题为占位解析）。
- 已确认：
  - 听力区结构完整，范围为 `2.01-2.05`。
  - `2.03` 与 `2.04` 的 `options` 字段存在占位编号，需回收 script 题尾选项语义。
  - `2.05` 四题均无 question 级 script，仅 passage 级 script 可用；其中 `passage 1` 仅保留一条显式问句题尾，第二问题尾在源数据中缺失。
- 本轮覆盖：
  - 已完成 `2.01-1` 至 `2.01-6` explanation / explanation_expand 逐题重写。
  - 已完成 `2.02-1` 至 `2.02-7` explanation / explanation_expand 逐题重写。
  - 已完成 `2.03-1` 至 `2.03-6` explanation / explanation_expand 逐题重写（并按 script 回收选项语义）。
  - 已完成 `2.04-1` 至 `2.04-14` explanation / explanation_expand 逐题重写（并按 script 回收即時応答选项语义）。
  - 已完成 `2.05` 两个 passage、四道题 explanation / explanation_expand 逐题重写。
- 本轮结果：
  - `2.01` 整段终检通过：`QCOUNT=6 / ISSUES=0`。
  - `2.02` 整段终检通过：`QCOUNT=7 / ISSUES=0`。
  - `2.03` 整段终检通过：`QCOUNT=6 / ISSUES=0`。
  - `2.04` 整段终检通过：`QCOUNT=14 / ISSUES=0`。
  - `2.05` 整段终检通过：`QCOUNT=4 / ISSUES=0`。
  - `N1_2016_07` 听力整卷总检通过：`RANGE=2.01-2.05 / QCOUNT=37 / ISSUES=0`。
  - 标题规范复核通过：`4+4` 标题全量命中；旧标题与流程信号（`【问题翻译】/【判断方法】/【正确答案】/【判断口诀】/解析\n解析`）归零。
  - JSON 解析正常，听力区占位符 `⚠️` 已归零。
- 结构备注：
  - `2.05 / passage 1 / question 2` 在当前源数据中仍缺题尾。本轮按“可证据化最小闭环”写法保留，并在解析中显式标注待回源音频/原卷补证后再升级为完整逐项误选版。

### N1_2016_12

- 文件：`data/paper/jlpt/n1/N1_2016_12.json`
- 起手基线：听力区 `2.01-2.05` 共 `37` 题；起手 `issues=37`（全题仍为占位解析）。
- 已确认：
  - 听力区结构完整，范围为 `2.01-2.05`。
  - `2.03` 与 `2.04` 的 `options` 字段为占位编号，需按 script 题尾回收选项语义。
  - `2.05` 中 `passage 1` 仅保留一条显式题尾，且两问 `options` 字段均为占位编号；`passage 2` 两问题尾完整。
- 本轮覆盖：
  - 已完成 `2.01-1` 至 `2.01-6` explanation / explanation_expand 逐题重写。
  - 已完成 `2.02-1` 至 `2.02-7` explanation / explanation_expand 逐题重写。
  - 已完成 `2.03-1` 至 `2.03-6` explanation / explanation_expand 逐题重写（并按 script 回收选项语义）。
  - 已完成 `2.04-1` 至 `2.04-14` explanation / explanation_expand 逐题重写（并按 script 回收即時応答选项语义）。
  - 已完成 `2.05` 两个 passage、四道题 explanation / explanation_expand 逐题重写；其中 `passage 1 / question 2` 采用“可证据化最小闭环”写法并显式标注待补证。
- 本轮结果：
  - `2.01` 整段终检通过：`QCOUNT=6 / ISSUES=0`。
  - `2.02` 整段终检通过：`QCOUNT=7 / ISSUES=0`。
  - `2.03` 整段终检通过：`QCOUNT=6 / ISSUES=0`。
  - `2.04` 整段终检通过：`QCOUNT=14 / ISSUES=0`。
  - `2.05` 整段终检通过：`QCOUNT=4 / ISSUES=0`。
  - `N1_2016_12` 听力整卷总检通过：`RANGE=2.01-2.05 / QCOUNT=37 / ISSUES=0`。
  - 标题规范复核通过：`4+4` 标题全量命中；旧标题与流程信号（`【问题翻译】/【判断方法】/【正确答案】/【判断口诀】/解析\n解析/正确答案：/句意：`）归零。
  - JSON 解析正常，听力区占位符 `⚠️` 已归零。
- 结构备注：
  - `2.05 / passage 1 / question 2` 题尾文本在当前源数据中仍缺失。本轮已在正文中显式标注该缺口，并保持非臆造写法；后续若要升级为完整逐项误选版，需回源音频或原卷脚本补证。

### N1_2017_07

- 文件：`data/paper/jlpt/n1/N1_2017_07.json`
- 起手基线：听力区 `2.01-2.05` 共 `35` 题（`2.04` 为 13 题非 14 题）；起手 `issues=35`（全题仍为占位解析）。
- 已确认：
  - 听力区结构完整，范围为 `2.01-2.05`。
  - `2.03` 与 `2.04` 的 `options` 字段为占位编号，需按 script 题尾回收选项语义。
  - `2.05` 两个 passage 的 script 都包含显式 question 题尾（lines with 質問 / ですか）。
- 本轮覆盖：
  - 已完成 `2.01-1` 至 `2.01-6` explanation / explanation_expand 逐题重写。
  - 已完成 `2.02-1` 至 `2.02-6` explanation / explanation_expand 逐题重写。
  - 已完成 `2.03-1` 至 `2.03-6` explanation / explanation_expand 逐题重写（并按 script 回收选项语义）。
  - 已完成 `2.04-1` 至 `2.04-13` explanation / explanation_expand 逐题重写（并按 script 回收即時応答选项语义）。
  - 已完成 `2.05` 两个 passage、四道题的初步 explanation / explanation_expand 重写。
  - 进行了 `2.05` 深度二轮改写：针对 passage 1 Q1 与 Q2、passage 2 Q1 与 Q2，逐题补写具体证据链与条件排除逻辑。
- 本轮结果：
  - `2.01` 整段终检通过：`QCOUNT=6 / ISSUES=0`。
  - `2.02` 整段终检通过：`QCOUNT=6 / ISSUES=0`。
  - `2.03` 整段终检通过：`QCOUNT=6 / ISSUES=0`。
  - `2.04` 整段终检通过：`QCOUNT=13 / ISSUES=0`。
  - `2.05` 整段终检通过：`QCOUNT=4 / ISSUES=0`。
  - `N1_2017_07` 听力整卷总检通过：`RANGE=2.01-2.05 / QCOUNT=35 / ISSUES=0`。
  - 标题规范复核通过：`4+4` 标题全量命中；旧标题与流程信号归零。
  - JSON 解析正常，听力区占位符 `⚠️` 已归零。
- 结构备注：
  - `2.05` 两个 passage 均已从脚本题尾抽取了完整证据链，按"条件确认→选项排除→定案句"模式改写了所有 4 题，共计耗时两轮（初稿 + 深度补证）。

---

### N1_2017_12

- 文件：`data/paper/jlpt/n1/N1_2017_12.json`
- 起手基线：听力区 `2.01-2.05` 共 `35` 题；所有题目均为占位解析（`⚠️` 全量，说明文本仅含一行占位）。
- 已确认：
  - 听力区结构完整，范围为 `2.01-2.05`。
  - `2.01–2.04` 初稿完成后经检查发现使用了空模板（"选项X符合题目要求，与听力内容的关键信息一致"），触发二轮重写。
  - `2.05` passage 1 第2问题尾在脚本数据中缺失，按"可证据化最小闭环 + 显式标注"模式处理，明确注明待回源补证，未做任何臆造推断。
- 本轮覆盖：
  - 已完成 `2.01-1` 至 `2.01-6` 逐题重写（引用脚本具体对话句、行动信号词）。
  - 已完成 `2.02-1` 至 `2.02-6` 逐题重写（标注转折词前后结论差异）。
  - 已完成 `2.03-1` 至 `2.03-6` 逐题重写（抓重复关键词归纳主旨）。
  - 已完成 `2.04-1` 至 `2.04-13` 逐题重写（识别语用行为类型，逐项说明应答方向）。
  - 已完成 `2.05` 两个 passage 全 4 题改写，passage 2 两题含完整证据链（概率排除 + 「2枚使って」转折定案）。
  - 全程两轮：初稿发现模板残留 → 二轮按脚本逐题具体化 → 2.05 P1Q2 独立处理（结构缺损）。
- 本轮结果：
  - `2.01` 整段终检通过：`QCOUNT=6 / ISSUES=0`。
  - `2.02` 整段终检通过：`QCOUNT=6 / ISSUES=0`。
  - `2.03` 整段终检通过：`QCOUNT=6 / ISSUES=0`。
  - `2.04` 整段终检通过：`QCOUNT=13 / ISSUES=0`。
  - `2.05` 整段终检通过：`QCOUNT=4 / ISSUES=0`。
  - `N1_2017_12` 听力整卷总检通过：`RANGE=2.01-2.05 / QCOUNT=35 / ISSUES=0`。
  - 标题规范复核通过：`4+4` 标题全量命中；旧标题与流程信号归零。
  - JSON 解析正常，听力区占位符 `⚠️` 已归零。
- 结构备注：
  - `2.05` passage 1 Q2 题尾缺失，采用"可证据化最小闭环"模式，明确标注 `script 欠損 / 題尾未回収 / 要回源音频复核`，未写任何超越脚本证据的推断。
  - 全套 35 题均已达到出版物级别的证据驱动解析；本轮重写揭示了初稿泛模板残留的问题，已在二轮中完全消除。

---

### N1_2018_07

- 文件：`data/paper/jlpt/n1/N1_2018_07.json`
- 起手基线：听力区 `2.01-2.05` 共 `35` 题；起手存在大量占位解析与警示标记（全段合计 `⚠️=96`），其中 `2.03/2.04/2.05` 存在占位选项文本。
- 已确认：
  - 听力区结构完整，范围为 `2.01-2.05`。
  - `2.04` 与 `2.05` 可从脚本中回收选项语义并完成证据链改写。
  - `2.03` 为结构性缺源：题干为空、脚本为空、选项为 `1.1/2.2/3.3/4.4` 占位，无法从当前 JSON 直接回收真实选项语义。
- 本轮覆盖：
  - 已完成 `2.01-1` 至 `2.01-6` explanation / explanation_expand 逐题重写。
  - 已完成 `2.02-1` 至 `2.02-6` explanation / explanation_expand 逐题重写。
  - 已完成 `2.03-1` 至 `2.03-6` explanation / explanation_expand 逐题重写（按“缺源最小闭环”写法，显式标注待回源补证，未臆造）。
  - 已完成 `2.04-1` 至 `2.04-13` explanation / explanation_expand 逐题重写（并按 script 回收即時応答选项语义）。
  - 已完成 `2.05` 两个 passage、四道题 explanation / explanation_expand 逐题重写（按条件筛选与排除链写法落实证据）。
- 本轮结果：
  - `2.01` 整段终检通过：`QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.02` 整段终检通过：`QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.03` 标题与警示终检通过：`QCOUNT=6 / WARN=0 / ISSUES=0`；但保留 `PLACEHOLDER_OPTS=24`（源数据缺失导致无法回收）。
  - `2.04` 整段终检通过：`QCOUNT=13 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.05` 整段终检通过：`QCOUNT=4 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `N1_2018_07` 听力整卷结构终检通过：`RANGE=2.01-2.05 / QCOUNT=35 / WARN=0 / HEADING_ISSUES=0`。
  - 标题规范复核通过：`4+4` 标题全量命中；旧标题与流程信号归零。
  - JSON 解析正常。
- 结构备注：
  - `2.03` 当前并未达到“可逐项误选排除”的满证据状态，阻塞点是源数据无题干/无脚本/无真实选项。已按出版流程要求显式挂牌“待回源补证”，并维持非臆造写法。

---

### N1_2018_12

- 文件：`data/paper/jlpt/n1/N1_2018_12.json`
- 起手基线：听力区 `2.01-2.05` 共 `35` 题；起手警示标记高（`⚠️` 合计 `105`），并伴随多段占位选项（`2.01/2.03/2.04/2.05`）。
- 已确认：
  - 听力区结构完整，范围为 `2.01-2.05`。
  - `2.01-2.04` 的可用证据主要在 `question.script`（list-dict）；`2.05` 证据主要在 `passage.script`。
  - 初稿通过格式校验但内容偏空泛，随后进行了二轮与三轮提质：先回收选项语义，再清理泛化误项分析与过度证据表述。
- 本轮覆盖：
  - 已完成 `2.01-1` 至 `2.01-6` explanation / explanation_expand 逐题重写（含排班类条件组合证据）。
  - 已完成 `2.02-1` 至 `2.02-6` explanation / explanation_expand 逐题重写（并对“证据不足”题显式标注待补证，避免伪证据）。
  - 已完成 `2.03-1` 至 `2.03-6` explanation / explanation_expand 逐题重写（按脚本可见信息与答案键做最小闭环，不臆造）。
  - 已完成 `2.04-1` 至 `2.04-13` explanation / explanation_expand 逐题重写（语用行为匹配：拒绝/质疑/确认等）。
  - 已完成 `2.05` 两个 passage 全 4 题重写，并回收了题目选项文本（`マリン/スター/ベスト/ダイヤ`、`ある一日/ファミリー/大空へ/砂の家`）。
- 本轮结果：
  - `2.01` 整段终检通过：`QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.02` 整段终检通过：`QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.03` 整段终检通过：`QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.04` 整段终检通过：`QCOUNT=13 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.05` 整段终检通过：`QCOUNT=4 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `N1_2018_12` 听力整卷终检通过：`RANGE=2.01-2.05 / QCOUNT=35 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0`。
  - 标题规范复核通过：`4+4` 标题全量命中；旧标题与警示符已清零。
  - JSON 解析正常。
- 结构备注：
  - `2.02/2.03` 个别题在“可见脚本片段无非选项定案句”场景下，采用“答案键一致 + 待回源音频补证”写法，避免把不充分片段写成强证据。

---

### N1_2019_07

- 文件：`data/paper/jlpt/n1/N1_2019_07.json`
- 起手基线：听力区 `2.01-2.05` 共 `35` 题；起手警示符高（`⚠️=102`），并存在占位选项（`2.03=24`、`2.04=39`、`2.05=8`）。
- 已确认：
  - 听力区结构完整，范围为 `2.01-2.05`。
  - `2.01-2.04` 主要证据在 `question.script`（list-dict）；`2.05` 主要证据在 `passage.script`（list-dict）。
  - 处理中已修复脚本解析分支（避免对 dict 调用 `strip()`）。
- 本轮覆盖：
  - 已完成 `2.01-1` 至 `2.01-6` explanation / explanation_expand 逐题重写，并回收选项文本。
  - 已完成 `2.02-1` 至 `2.02-6` explanation / explanation_expand 逐题重写，并按脚本可见证据重建误项排除。
  - 已完成 `2.03-1` 至 `2.03-6` explanation / explanation_expand 逐题重写，并从脚本回收主旨题选项语义。
  - 已完成 `2.04-1` 至 `2.04-13` explanation / explanation_expand 逐题重写，按语用功能做应答匹配。
  - 已完成 `2.05` 两个 passage 全 4 题改写并回收方案类选项（含 `基本チェックプラン/スピードプラン/安心プラン/専門チェックプラン`）。
- 本轮结果：
  - `2.01` 终检通过：`QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.02` 终检通过：`QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.03` 终检通过：`QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.04` 终检通过：`QCOUNT=13 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.05` 终检通过：`QCOUNT=4 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `N1_2019_07` 听力整卷终检通过：`RANGE=2.01-2.05 / QCOUNT=35 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0`。
  - 标题规范复核通过：`4+4` 标题全量命中；旧模板词归零。
  - JSON 解析正常。
- 结构备注：
  - `2.02/2.03` 个别题可见脚本片段未出现强“定案句”词证，已按“答案键一致 + 可见证据边界”写法处理，避免把弱片段硬写成强证据。

---

### N1_2019_12

- 文件：`data/paper/jlpt/n1/N1_2019_12.json`
- 起手基线：听力区 `2.01-2.05` 共 `35` 题；起手警示符密集，且 `2.03/2.04/2.05` 带有大量占位选项。
- 已确认：
  - 听力区结构完整，范围为 `2.01-2.05`。
  - `2.01-2.04` 的主要证据在 `question.script`；`2.05` 的主要证据在 `passage.script`，且均为 `list[dict]` 结构。
  - 初版自动重写虽然过结构校验，但正文基本仍是空模板；随后追加了脚本驱动重写脚本并进行人工抽样校正。
- 本轮覆盖：
  - 已完成 `2.01-1` 至 `2.01-6` explanation / explanation_expand 逐题重写，并按脚本回收图书馆处理流程等行动题证据。
  - 已完成 `2.02-1` 至 `2.02-6` 逐题重写，重点用“タイムスリップしたような感覚”“それがたまんなくて”等感受句锁定答案。
  - 已完成 `2.03-1` 至 `2.03-6` 逐题重写，按“異文化体験は人を大きく成長させ…”等总结句提炼主旨。
  - 已完成 `2.04-1` 至 `2.04-13` 逐题重写，按语用方向解释为什么能接话/不能接话。
  - 已完成 `2.05` 两个 passage 全 4 题重写，并回收了 `日本の漁業/北海道の漁業/漁業の未来/新しい漁業` 等选项语义。
- 本轮结果：
  - `2.01` 终检通过：`QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.02` 终检通过：`QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.03` 终检通过：`QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.04` 终检通过：`QCOUNT=13 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.05` 终检通过：`QCOUNT=4 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `N1_2019_12` 听力整卷终检通过：`RANGE=2.01-2.05 / QCOUNT=35 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0`。
  - 标题规范复核通过：`4+4` 标题全量命中；禁用模板词归零。
  - JSON 解析正常。
- 结构备注：
  - 本轮的关键修复点不是字段缺失，而是“内容虽成型但证据句抓取过弱”；最终通过脚本驱动重写 + 人工抽样修正，把 `2.01/2.02/2.03/2.05` 的定案句改为更贴近原文结论的位置。

---

### N1_2020_12

- 文件：`data/paper/jlpt/n1/N1_2020_12.json`
- 起手基线：听力区 `2.01-2.05` 共 `35` 题；起手警示符高，`2.03/2.04/2.05` 带有占位选项。
- 已确认：
  - 听力区结构完整，范围为 `2.01-2.05`。
  - `2.01-2.04` 的主要证据在 `question.script`；`2.05` 的主要证据在 `passage.script`，且多为 `list[dict]` 结构。
  - `2.05` 本卷真实结构是 `1+2`，共 `3` 题，而不是固定 `4` 题。
- 本轮覆盖：
  - 已完成 `2.01-1` 至 `2.01-6` explanation / explanation_expand 逐题重写，并回收行动题选项语义。
  - 已完成 `2.02-1` 至 `2.02-7` explanation / explanation_expand 逐题重写（按转折后结论与“残念”类判断句落定）。
  - 已完成 `2.03-1` 至 `2.03-6` explanation / explanation_expand 逐题重写，并从脚本尾部回收主旨题选项文本。
  - 已完成 `2.04-1` 至 `2.04-13` explanation / explanation_expand 逐题重写，按语用功能解释应答方向。
  - 已完成 `2.05` 全 `3` 题重写，并对 `passage 1` 的会议讨论题进行了手工精修，明确区分“被提出的方案”与“最终拍板的方案”。
- 本轮结果：
  - `2.01` 终检通过：`QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.02` 终检通过：`QCOUNT=7 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.03` 终检通过：`QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.04` 终检通过：`QCOUNT=13 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.05` 终检通过：`QCOUNT=3 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `N1_2020_12` 听力整卷终检通过：`RANGE=2.01-2.05 / QCOUNT=35 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0`。
  - 标题规范复核通过：`4+4` 标题全量命中；禁用模板词归零。
  - JSON 解析正常。
- 结构备注：
  - 本轮关键修复点有二：一是 `question/options` 既有 dict 也有 string，需要同时兼容才能正确回收选项；二是 `2.05` 会议类题必须手工把最终拍板句与前面被否掉的备选方案分开。

### N1_2021_07

- 文件：`data/paper/jlpt/n1/N1_2021_07.json`
- 起手基线：听力区 `2.01-2.05` 共 `35` 题（`2.05` 为 `1+2` 结构，共 `3` 题）；`2.03/2.04/2.05` 带有占位选项，需逐项回收。
- 已确认：
  - 听力区结构完整，范围为 `2.01-2.05`。
  - `2.01-2.04` 的证据主要在 `passage.script` 中；`2.05` 为双 passage 结构，分别是会议讨论和新闻评论。
  - `2.05/passage 1`：研修冒头活动选择（方案讨论→转折→拍板）。
  - `2.05/passage 2`：市长选举候选人听讨论（两人基于不同需求支持不同候选人）。
- 本轮覆盖：
  - 已完成 `2.01-1` 至 `2.01-6` explanation / explanation_expand 一轮自动重写，回收脚本选项。
  - 已完成 `2.02-1` 至 `2.02-7` explanation / explanation_expand 一轮自动重写，转折后判断清晰。
  - 已完成 `2.03-1` 至 `2.03-6` explanation / explanation_expand 一轮自动重写，脚本尾部选项回收完毕。
  - 已完成 `2.04-1` 至 `2.04-13` explanation / explanation_expand 一轮自动重写，语用判断确立。
  - 已完成 `2.05/passage 1` Q1 手工重写：明确女上司的最终意见"ただ、やっぱり、単に緊張ほぐすとか、盛り上がるっていうものより研修内容に繋がるものにしましょう"决定了最终方案（参加者同士の共通点を探す活動）。
  - 已完成 `2.05/passage 2` Q1、Q2 手工重写：女听的是"市民の健康のための事業"（山田えり子氏），男支持的是"郊外の住宅地と市街中を結ぶ公共交通支援事業"（石井かずお氏），两人因个人需求不同而支持不同候选。
- 本轮结果：
  - `2.01` 终检通过：`QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.02` 终检通过：`QCOUNT=7 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.03` 终检通过：`QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.04` 终检通过：`QCOUNT=13 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.05` 终检通过：`QCOUNT=3 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `N1_2021_07` 听力整卷终检通过：`RANGE=2.01-2.05 / QCOUNT=35 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0`。
  - 标题规范复核通过：`4+4` 标题全量命中；禁用模板词归零。
  - JSON 解析正常。
- 结构备注：
  - `2.05/passage 1`：会议类题目需从"方案提出"→"中途讨论"→"反对理由"→"最后转折定案"全程跟踪定案句。本卷中女1的最后两句是关键。
  - `2.05/passage 2`：选举讨论题需从"新闻背景（各候选人政策）"→"个人描述（具体细节）"→"定位支持对象"的逻辑链清晰。本卷女描述健康政策指向山田氏，男描述交通困难指向石井氏。

  ### N1_2021_12

  - 文件：`data/paper/jlpt/n1/N1_2021_12.json`
  - 起手基线：听力区 `2.01-2.05` 共 `35` 题（`2.05` 为 `1+2` 结构，共 `3` 题）；起手状态 `2.01-2.04` 无占位选项，`2.05` 带有少量占位。
  - 已确认：
    - 听力区结构完整，范围为 `2.01-2.05`。
    - `2.01-2.04` 的证据在 `passage.script` 中；`2.05` 为双 passage 结构，分别是健康对策会议讨论和地铁改良四案评议。
    - `2.05/passage 1`：会议场景（上司+两名员工讨论三个健康对策方案，最后上司确定方案）。
    - `2.05/passage 2`：市政评议场景（市长介绍四个地铁改良方案，两位市民基于各自需求表达倾向）。
  - 本轮覆盖：
    - 已完成 `2.01-1` 至 `2.01-6` explanation / explanation_expand 一轮自动重写，不含占位选项。
    - 已完成 `2.02-1` 至 `2.02-7` explanation / explanation_expand 一轮自动重写，转折后信息结构清晰。
    - 已完成 `2.03-1` 至 `2.03-6` explanation / explanation_expand 一轮自动重写，脚本选项回收完毕。
    - 已完成 `2.04-1` 至 `2.04-13` explanation / explanation_expand 一轮自动重写，语用应答分析确立。
    - 已完成 `2.05/passage 1` Q1 手工重写：上司在评价三个方案（女提议的禁电梯、男2提议的延长食堂时间、女再次提议的健走大会）后，以"ニーズが高そうで効果はありそうな案"为标准，最终确定选择男2提议的"食堂の営業時間を延長すること"。
    - 已完成 `2.05/passage 2` Q1、Q2 手工重写：男优先支持案1（指示标识改善）的理由是"わかりにくくて困ること多い，まずはそれを改善"；女优先支持案2（无障碍/电梯）的理由是"スーツケース持って移動する時，最寄駅にエレベーターなくて大変だから"。两人虽听了相同内容但因个人需求不同而倾向不同方案。
  - 本轮结果：
    - `2.01` 终检通过：`QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
    - `2.02` 终检通过：`QCOUNT=7 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
    - `2.03` 终检通过：`QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
    - `2.04` 终检通过：`QCOUNT=13 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
    - `2.05` 终检通过：`QCOUNT=3 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
    - `N1_2021_12` 听力整卷终检通过：`RANGE=2.01-2.05 / QCOUNT=35 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0`。
    - 标题规范复核通过：`4+4` 标题全量命中；禁用模板词归零。
    - JSON 解析正常。
  - 结构备注：
    - `2.05/passage 1`：会议讨论题需清晰区分"被提出的备选方案"与"最后确定的方案"。关键在于上司的最终总结句使用了"さっきの"来回指，必须准确判断它指向哪个方案。
    - `2.05/passage 2`：市政评议题中，虽然四个方案信息相同，但两个市民各自基于具体情景（一个常在地铁迷路，一个出差时需要拖行李）而支持不同方案。同样问题（男/女分别优先什么）的答案会不同，关键是抓住各自陈述中的"困难症状"和"改善期待"。

### N1_2022_07

- 文件：`data/paper/jlpt/n1/N1_2022_07.json`
- 起手基线：听力区 `2.01-2.05` 共 `35` 题（`2.05` 为 `1+2` 结构，共 `3` 题）；起手 `WARN=105`，`4+4` 标题缺失，`2.05` 题解与定案句对应偏弱。
- 已确认：
  - 听力区结构完整，范围为 `2.01-2.05`。
  - 需统一收口到当前听力 `4+4` 标题体系与定案句证据口径。
  - `2.05/passage 1` 为部门会议改进流程定案题；`2.05/passage 2` 为双人物分流选房间题。
- 本轮覆盖：
  - 已完成 `2.01-1` 至 `2.01-6` explanation / explanation_expand 一轮重写并统一标题。
  - 已完成 `2.02-1` 至 `2.02-7` explanation / explanation_expand 一轮重写并统一标题。
  - 已完成 `2.03-1` 至 `2.03-6` explanation / explanation_expand 一轮重写并统一标题。
  - 已完成 `2.04-1` 至 `2.04-13` explanation / explanation_expand 一轮重写并统一标题。
  - 已完成 `2.05` 三题手工精修：
    - `P1/Q1`：明确最终执行项是“会前在出席者间共享意见”，并与“压缩议题”“到点结束”“会前发资料（既有做法）”区分。
    - `P2/Q1`：男方基于“母亲高龄心理低落、想听如何鼓励”锁定 `2番の部屋`（高齢者の心の問題とその対応）。
    - `P2/Q2`：女方基于“睡眠不足与生活习惯、预防为主”锁定 `1番の部屋`（予防医学・睡眠/栄養）。
- 本轮结果：
  - `2.01` 终检通过：`QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.02` 终检通过：`QCOUNT=7 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.03` 终检通过：`QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.04` 终检通过：`QCOUNT=13 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.05` 终检通过：`QCOUNT=3 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `N1_2022_07` 听力整卷终检通过：`RANGE=2.01-2.05 / QCOUNT=35 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0`。
  - 标题规范复核通过：`4+4` 标题全量命中；禁用模板词归零。
  - JSON 解析正常。
- 结构备注：
  - `2.05/passage 1`：会议类题需按“提案→反证→拍板”链路取证，只有落到“次回から実施”级别执行句才是答案。
  - `2.05/passage 2`：双人物分流题要分别追踪“人物需求→主题房间”映射，避免把同段另一人物的需求误投到当前题。

### N1_2023_07

- 文件：data/paper/jlpt/n1/N1_2023_07.json
- 起手基线：听力区 2.01-2.05 共 30 题；起手 WARN=90，4+4 标题缺失，且 2.03/2.04/2.05 含占位选项。
- 已确认：
  - 听力区结构完整，范围为 2.01-2.05。
  - 2.05 为 1+2 结构：P1 为餐厅经营会议定案题，P2 为男女分流选书店题。
- 本轮覆盖：
  - 已完成 2.01-2.04 全量 explanation / explanation_expand 自动重写，统一 4+4 标题。
  - 已完成 2.03/2.04 占位选项回收，2.05 选项文本补全。
  - 已完成 2.05 三题手工精修：
    - P1/Q1：明确最终拍板是“让厨房设计新菜单”，对应“部分更换沙拉吧内容”，并排除“取消/涨价”分支。
    - P2/Q1（男）：按“草花专业书 + 古地图鉴”需求锁定岛田书店。
    - P2/Q2（女）：按“江户时代地图资料”需求锁定ミナミブックス。
- 本轮结果：
  - 2.01 终检通过：QCOUNT=5 / WARN=0 / PLACEHOLDER_OPTS=0。
  - 2.02 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0。
  - 2.03 终检通过：QCOUNT=5 / WARN=0 / PLACEHOLDER_OPTS=0。
  - 2.04 终检通过：QCOUNT=11 / WARN=0 / PLACEHOLDER_OPTS=0。
  - 2.05 终检通过：QCOUNT=3 / WARN=0 / PLACEHOLDER_OPTS=0。
  - N1_2023_07 听力整卷终检通过：OVERALL=PASS。
- 结构备注：
  - 2.05/P1：会议类题要识别“提出方案”和“最终执行方案”的差异，只有落到“ことにしよう”才算定案。
  - 2.05/P2：分流题需分别绑定人物需求，避免把同段另一人物目标误判到当前题。

### N1_2022_12

- 文件：data/paper/jlpt/n1/N1_2022_12.json
- 起手基线：听力区 2.01-2.05 共 30 题；起手 WARN=87，4+4 标题缺失，2.05 带有占位符。
- 已确认：
  - 听力区结构完整，范围为 2.01-2.05。
  - 2.01-2.04 的证据在 question.script 中；2.05 的证据在 passage.script 中。
- 本轮覆盖：
  - 已完成 2.01-2.04 全量 explanation / explanation_expand 重写，统一 4+4 标题。
  - 已完成 2.03 部分占位选项的回收（基于脚本正则提取）。
  - 已完成 2.05 三题手工精修：
    - P1/Q1：日语志愿者募集案。通过对比“マニュアル（否定）”“種類分け（最终未采纳）”，锁定最终决议为“大学张贴海报”。
    - P2/Q1（女）：基于体力要求及社交偏好（カフェ、収穫体験）选择“草莓”。
    - P2/Q2（男）：由于追求收益且关注新名产评价，选择“卷心菜”。
- 本轮结果：
  - 2.01 终检通过：QCOUNT=5 / WARN=0 / PLACEHOLDER_OPTS=0。
  - 2.02 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0。
  - 2.03 终检通过：QCOUNT=5 / WARN=0 / PLACEHOLDER_OPTS=0。
  - 2.04 终检通过：QCOUNT=11 / WARN=0 / PLACEHOLDER_OPTS=0。
  - 2.05 终检通过：QCOUNT=3 / WARN=0 / PLACEHOLDER_OPTS=0。
  - N1_2022_12 听力整卷终检通过：OVERALL=PASS。
- 结构备注：
  - 2.05/P1：典型的“多方案筛选”题，需识别出“尝试过但无效”“提议但被否”“提议但最终决定先做别的”等逻辑层次。
  - 2.05/P2：双人分流题，由于四种作物特征明确（收益、体力需求、互动性、传统性），需与人物自述需求精准对齐。

### N1_2023_12

- 文件：data/paper/jlpt/n1/N1_2023_12.json
- 起手基线：听力区 2.01-2.05 共 30 题；起手存在高量 WARN 与 4+4 标题缺失，且 2.03/2.04/2.05 带占位选项。
- 已确认：
  - 听力区结构完整，范围为 2.01-2.05。
  - 2.05 为 1+2 结构：P1 文化讲座定案题，P2 夫妻选梨分流题。
- 本轮覆盖：
  - 已完成 2.01-2.04 explanation / explanation_expand 一轮自动重写，统一 4+4 标题。
  - 已完成 2.03/2.04/2.05 占位选项回收，选项文本恢复。
  - 已完成 2.05 三题手工精修：
    - P1/Q1：以“幅广年龄层参与”为筛选标准，最终定案为「町の産業を知ろう」。
    - P2/Q1：女方依据“甘みが強い”锁定 ひかり。
    - P2/Q2：男方在“みずみずしい/正月可食”与“见栄え・赠答品”之间比较后，最终锁定 ほしぞら。
- 本轮结果：
  - 2.01 终检通过：QCOUNT=5 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.02 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.03 终检通过：QCOUNT=5 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.04 终检通过：QCOUNT=11 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.05 终检通过：QCOUNT=3 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - N1_2023_12 听力整卷终检通过：RANGE=2.01-2.05 / QCOUNT=30 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0。
  - 标题规范复核通过：4+4 标题全量命中；禁用模板词归零。
  - JSON 解析正常。
- 结构备注：
  - 2.05/passage 1：会议定案题应抓“目标约束（覆盖年龄层）→提案淘汰→拍板句（それでいこう）”链路。
  - 2.05/passage 2：人物分流题需优先读取转折后的最终偏好（如 でも / やっぱり 后），避免被前置偏好干扰。

### N1_2024_07

- 文件：data/paper/jlpt/n1/N1_2024_07.json
- 起手基线：听力区 2.01-2.05 共 30 题；起手无 WARN，但 `2.03/2.04/2.05` 含占位选项，且 explanation / explanation_expand 均未统一到当前听力 `4+4` 标题体系。
- 已确认：
  - 听力区结构完整，范围为 2.01-2.05。
  - `2.05` 为 `1+2` 结构：P1 为新闻部棒球特集定案题，P2 为双人物协商选择天文讲座题。
- 本轮覆盖：
  - 已完成 `2.01-2.04` explanation / explanation_expand 一轮自动重写，统一 `4+4` 标题。
  - 已完成 `2.03/2.04/2.05` 占位选项回收，恢复选项文本。
  - 已完成 `2.05` 三题手工精修：
    - `P1/Q1`：从“旧题材/对手练习/全员介绍/密着取材”中，依据部长拍板句锁定「主要な選手の1日の過ごし方」。
    - `P2/Q1`：按“最初想法”时间点，锁定女方先想参加 `講座4番`（国际空间站观察）。
    - `P2/Q2`：按双方协商后的最终决定，锁定 `講座3番`（流星观察）。
- 本轮结果：
  - 2.01 终检通过：QCOUNT=5 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.02 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.03 终检通过：QCOUNT=5 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.04 终检通过：QCOUNT=11 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.05 终检通过：QCOUNT=3 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - N1_2024_07 听力整卷终检通过：RANGE=2.01-2.05 / QCOUNT=30 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0。
  - 标题规范复核通过：4+4 标题全量命中；禁用模板词归零。
  - JSON 解析正常。
- 结构备注：
  - 2.05/passage 1：会议定案题需分清“旧方案回顾”“被否提案”“受版面限制淘汰项”与“最终拍板项”，只认 `今回は〜することにしよう` 这类执行句。
  - 2.05/passage 2：双问题共用同一段对话时，要严格区分“最初想法”和“最后决定”两个时间点，不能混用同一证据句。

### N1_2024_12

- 文件：data/paper/jlpt/n1/N1_2024_12.json
- 起手基线：听力区 2.01-2.05 共 30 题；`2.01/2.02` 仍残留 WARN，`2.03/2.04/2.05` 含占位选项，且 explanation / explanation_expand 全量缺失当前听力 `4+4` 标题。
- 已确认：
  - 听力区结构完整，范围为 2.01-2.05。
  - `2.05` 为 `1+2` 结构：P1 为书店营业额恢复方案定案题，P2 为夫妻协商参观工厂选择题。
- 本轮覆盖：
  - 已完成 `2.01-2.04` explanation / explanation_expand 一轮自动重写，统一当前听力 `4+4` 标题。
  - 已完成 `2.03/2.04/2.05` 占位选项回收，恢复选项文本。
  - 已修正 `rewrite_n1_2024_12_listening.py` 一度漂移的非标准标题模板，使其重新对齐当前听力 `4+4` 口径。
  - 已完成 `2.05` 三题手工精修：
    - `P1/Q1`：从多个营业改善提案中，依据店长最终拍板句锁定「デザイン関連の本のコーナーを作る。」。
    - `P2/Q1`：按男方“先觉得有意思 → 考虑带孩子 → 否定球类工厂 → 锁定自制杯装汤”的修正链，锁定 `ヒガシヤ`。
    - `P2/Q2`：按女方“拒绝买限定商品 → 更看重可带回家继续玩的纪念品”的筛选条件，锁定 `ミナミ`。
- 本轮结果：
  - 2.01 终检通过：QCOUNT=5 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.02 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.03 终检通过：QCOUNT=5 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.04 终检通过：QCOUNT=11 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.05 终检通过：QCOUNT=3 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - N1_2024_12 听力整卷终检通过：RANGE=2.01-2.05 / QCOUNT=30 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0。
  - 标题规范复核通过：4+4 标题全量命中；禁用模板词归零。
  - JSON 解析正常。
- 结构备注：
  - 2.05/passage 1：典型“提案很多但只认店长拍板句”的会议定案题，不能把前面建议直接当答案。
  - 2.05/passage 2：双人物偏好题需严格分开“男方改口后的最终想法”和“女方按新条件筛出的偏好”，不能被中途误解句带偏。

### N1_2025_07

- 文件：data/paper/jlpt/n1/N1_2025_07.json
- 起手基线：听力区 2.01-2.05 共 30 题；`2.01` 有 `WARN=4`、`2.02` 有 `WARN=1`，`2.03/2.04/2.05` 含占位选项，且 explanation / explanation_expand 全量缺失当前听力 `4+4` 标题。
- 已确认：
  - 听力区结构完整，范围为 2.01-2.05。
  - `2.05` 为 `1+2` 结构：P1 为夏季登山路线协商定案题，P2 为男女两人选择香水题。
  - `2.05 / passage 2` 原始选项文本带有 `1.1番 / 2.2番` 形式的坏前缀，需在自动重写时额外清洗并写回 JSON。
- 本轮覆盖：
  - 已新增 `rewrite_n1_2025_07_listening.py`，完成 `2.01-2.04` explanation / explanation_expand 一轮自动重写，统一当前听力 `4+4` 标题。
  - 已完成 `2.03/2.04/2.05` 占位选项回收；并修正 `rewrite_n1_2025_07_listening.py` 的选项清洗逻辑，使 `1.1番` 类坏前缀归一为标准选项文本并回写 JSON。
  - 已新增 `fix_n1_2025_07_205.py`，完成 `2.05` 三题手工精修：
    - `P1/Q1`：按“交流优先、适合边走边聊、且不要拥挤”的最终筛选条件，锁定 `2番コース`。
    - `P2/Q1`：按男方“1番/3番之间犹豫 → 一度想选平时常用的水果香 → 最后改口选和平时不同的味道”的修正链，锁定 `3番`。
    - `P2/Q2`：按女方“直接说选让人清爽的香味 → 顺手排除自己已有同类甜香”的信息流，锁定 `2番`。
- 本轮结果：
  - 2.01 终检通过：QCOUNT=5 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.02 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.03 终检通过：QCOUNT=5 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.04 终检通过：QCOUNT=11 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.05 终检通过：QCOUNT=3 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - N1_2025_07 听力整卷终检通过：RANGE=2.01-2.05 / QCOUNT=30 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0。
  - 标题规范复核通过：4+4 标题全量命中；禁用模板词归零。
  - JSON 解析正常。
- 结构备注：
  - 2.05/passage 1：如果拍板句不再复述号码，要把最终总结出的条件回扣到前面具体提案，不能停在最早出现的建议句。
  - 2.05/passage 2：人物偏好题要特别注意“先想选什么”和“最后改口选什么”是两个时间点，`やっぱり` 之后的修正优先级最高。

### N1_2012_12（补记）

- 文件：data/paper/jlpt/n1/N1_2012_12.json
- 补记背景：仓库 memory 里已有本卷听力整卷通过记录，但 listening worklog 缺少对应条目；本轮复核时又发现 `2.03/2.04` 的题目选项仍残留占位文本，需要做一次收口补记。
- 已确认：
  - 听力区结构完整，范围为 2.01-2.05。
  - explanation / explanation_expand 已整体符合当前听力 `4+4` 标题；主要遗留问题是 `2.03` 有 `20` 个占位选项、`2.04` 有 `42` 个占位选项。
  - `2.05` 维持真实 `1+2` 结构：P1 为单题花卉选择题，P2 为两问画作选择题，本轮无需重写其解析正文。
- 本轮覆盖：
  - 已新增 `fix_n1_2012_12_203_204_options.py`，仅针对 `2.03/2.04` 从脚本尾部回收并清洗选项文本，不改动现有 explanation / explanation_expand。
  - 已将 `2.03` 的 `1.1 / 2.2 / 3.3 / 4.4` 占位选项恢复为实际题面文本。
  - 已将 `2.04` 的 `1.1 / 2.2 / 3.3` 占位选项恢复为实际应答句文本。
- 本轮结果：
  - 2.01 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.02 终检通过：QCOUNT=7 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.03 终检通过：QCOUNT=5 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.04 终检通过：QCOUNT=14 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.05 终检通过：QCOUNT=3 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - N1_2012_12 听力整卷终检通过：RANGE=2.01-2.05 / QCOUNT=35 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0。
  - 标题规范复核通过：4+4 标题全量命中；禁用模板词归零。
  - JSON 解析正常。
- 结构备注：
  - 2.03/2.04 这类尾部播报选项的题型，若正文解析已完成但 `options` 仍是占位编号，优先做“脚本尾部回收 + 选项回写”而不是整段重写。
  - 2.05 / passage 1 的单数提示语 `質問と選択肢` 已与当前 `1+2` 结构一致；后续不要再把旧 ghost question object 补回去。

### N1_2013_07（补记）

- 文件：data/paper/jlpt/n1/N1_2013_07.json
- 补记背景：repo memory 已记录本卷听力整卷通过，但 listening worklog 缺少对应条目；本轮复核时又发现 `2.03/2.04/2.05` 仍残留选项占位文本，需要做一次成品层补记。
- 已确认：
  - 听力区结构完整，范围为 2.01-2.05。
  - explanation / explanation_expand 已整体符合当前听力 `4+4` 标题；主要遗留问题是 `2.03` 有 `24` 个占位选项、`2.04` 有 `42` 个占位选项、`2.05` 有 `4` 个占位选项。
  - `2.05` 维持真实 `1+2` 结构：P1 为单题电视选择题，P2 为两问手表选择题；其中 `P1` 的当前 script 只保留到问句，未再挂出尾部四个选项播报。
- 本轮覆盖：
  - 已新增 `fix_n1_2013_07_listening_options.py`，仅针对 `2.03/2.04/2.05` 回收并清洗选项文本，不改动现有 explanation / explanation_expand。
  - 已将 `2.03` 的 `1.1 / 2.2 / 3.3 / 4.4` 占位选项恢复为脚本尾部的实际题面文本。
  - 已将 `2.04` 的 `1.1 / 2.2 / 3.3` 占位选项恢复为实际应答句文本。
  - 已将 `2.05 / passage 2` 的 `1. 商品番号1番` 这类带编号前缀文本清洗为标准选项正文；`passage 1` 因原 script 未保留选项播报，按当前问法回写为 `1番 / 2番 / 3番 / 4番` 的标准编号标签。
- 本轮结果：
  - 2.01 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.02 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.03 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.04 终检通过：QCOUNT=14 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.05 终检通过：QCOUNT=3 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - N1_2013_07 听力整卷终检通过：RANGE=2.01-2.05 / QCOUNT=35 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0。
  - 标题规范复核通过：4+4 标题全量命中；禁用模板词归零。
  - JSON 解析正常。
- 结构备注：
  - 若正文解析已完成而占位项只残留在 `options` 字段，优先做局部“选项回收 + 选项回写”，不要为此重放整段 explanation patch。
  - `2.05 / passage 1` 若 script 只保留到问句、没有尾部选项播报，应明确保留真实单题结构，并使用与问法一致的最小标准编号标签，而不是再补回 ghost question 或凭空扩写脚本。

### N1_2013_12（补记）

- 文件：data/paper/jlpt/n1/N1_2013_12.json
- 补记背景：repo memory 已记录本卷听力整卷通过，但 listening worklog 缺少对应条目；本轮复核时又发现 `2.03/2.04/2.05` 仍残留选项占位文本，且 `2.05` 有局部 explanation 标题漂移，需要做一次成品层补记。
- 已确认：
  - 听力区结构完整，范围为 2.01-2.05。
  - explanation / explanation_expand 主体已基本符合当前听力口径；主要遗留问题是 `2.03` 有 `20` 个占位选项、`2.04` 有 `42` 个占位选项、`2.05` 有 `8` 个占位选项，且 `2.05` 的四个 question object 中有 `5` 处标题缺口。
  - `2.05` 当前数据版本保留 `passage 1 / question 2` 作为 ghost / 冗余条目；本轮按现有数据结构保留该对象，但将其说明文本统一到标准 `4+4` 标题。
- 本轮覆盖：
  - 已新增 `fix_n1_2013_12_listening_finalize.py`，完成 `2.03/2.04/2.05` 选项文本回收与清洗，不改动无关 section。
  - 已将 `2.03` 的 `1.1 / 2.2 / 3.3 / 4.4` 占位选项恢复为脚本尾部的实际题面文本。
  - 已将 `2.04` 的 `1.1 / 2.2 / 3.3` 占位选项恢复为实际应答句文本。
  - 已将 `2.05 / passage 1 / question 1` 的岗位选项恢复为 `ウェディング部門の補助 / フロントでの受付 / レストランでの接客 / ロビーでの接客`。
  - 已将 `2.05 / passage 2` 的 `1.ゼミナール１` 这类带编号前缀文本清洗为标准选项正文。
  - 已将 `2.05` 四题 explanation 统一到当前听力 `4+4` 标题：
    - `P1/Q1`：改写为标准“题目解析 / 为什么选1 / 误选项为什么错 / 拿分提醒”结构。
    - `P1/Q2`：保留为 ghost 说明项，但改为标准 `4+4` 标题，明确其不是音频中的真实第二问。
    - `P2/Q1`、`P2/Q2`：补齐 `【误选项为什么错】` 与 `【拿分提醒】`，保留原有信息流判断主线。
- 本轮结果：
  - 2.01 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.02 终检通过：QCOUNT=7 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.03 终检通过：QCOUNT=5 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.04 终检通过：QCOUNT=14 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.05 终检通过：QCOUNT=4 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - N1_2013_12 听力整卷终检通过：RANGE=2.01-2.05 / QCOUNT=36 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0。
  - 标题规范复核通过：4+4 标题全量命中；禁用模板词归零。
  - JSON 解析正常。
- 结构备注：
  - 若 `2.05` 已有可用正文解析，只是标题缺损或选项字段残留占位，应优先做局部 finalize 脚本，不要重放整段听力重写。
  - `2.05 / passage 1 / question 2` 在当前数据版本中仍作为 ghost 说明条目保留；后续若要改结构，必须先回源音频与题面版本，不能仅凭当前 JSON 直接删除。

### N1_2014_07（补记）

- 文件：data/paper/jlpt/n1/N1_2014_07.json
- 补记背景：repo memory 已记录本卷听力整卷通过，但 listening worklog 缺少对应条目；本轮复核时又发现 `2.03/2.04/2.05` 仍残留选项占位文本，且 `2.05 / passage 1 / question 2` 仍是旧式 ghost 说明标题，需要做一次成品层补记。
- 已确认：
  - 听力区结构完整，范围为 2.01-2.05。
  - explanation / explanation_expand 主体已符合当前听力口径；主要遗留问题是 `2.03` 有 `24` 个占位选项、`2.04` 有 `42` 个占位选项、`2.05` 有 `8` 个占位选项，且 `2.05` 尚有 `2` 处标题缺口。
  - `2.05 / passage 1 / question 2` 在当前数据版本中仍保留为 ghost / 冗余条目；本轮按现有数据结构保留该对象，但将其说明文本统一到标准 `4+4` 标题。
- 本轮覆盖：
  - 已新增 `fix_n1_2014_07_listening_finalize.py`，完成 `2.03/2.04/2.05` 选项文本回收与清洗，不改动无关 section。
  - 已将 `2.03` 的 `1.1 / 2.2 / 3.3 / 4.4` 占位选项恢复为脚本尾部的实际题面文本。
  - 已将 `2.04` 的 `1.1 / 2.2 / 3.3` 占位选项恢复为实际应答句文本。
  - 已将 `2.05 / passage 1` 的活动选项恢复为 `昔の暮らしを学ぶ会 / 祭り保存会 / 歴史名所クラブ / 民話に親しむ会`。
  - 已将 `2.05 / passage 2` 的 `1.コース1` 这类带编号前缀文本清洗为标准选项正文。
  - 已将 `2.05 / passage 1 / question 2` 的 ghost 说明改写为标准 `4+4` 标题，明确其不是音频中的真实第二问。
- 本轮结果：
  - 2.01 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.02 终检通过：QCOUNT=7 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.03 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.04 终检通过：QCOUNT=14 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.05 终检通过：QCOUNT=4 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - N1_2014_07 听力整卷终检通过：RANGE=2.01-2.05 / QCOUNT=37 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0。
  - 标题规范复核通过：4+4 标题全量命中；禁用模板词归零。
  - JSON 解析正常。
- 结构备注：
  - 若正文解析已完成而占位项只残留在 `options` 字段，优先做局部“选项回收 + 选项回写”，不要为此重放整段 explanation patch。
  - `2.05 / passage 1 / question 2` 在当前数据版本中继续作为 ghost 说明条目保留；后续若要改结构，必须先回源音频与题面版本，不能仅凭当前 JSON 直接删除。

### N1_2011_07（回补）

- 文件：data/paper/jlpt/n1/N1_2011_07.json
- 回补背景：本卷 listening worklog 与 repo memory 都已记录整卷听力通过，但当前 JSON 的 `2.03/2.04/2.05` 又出现了旧式 `options` 字段回退；正文 explanation 仍基本完整，因此本轮只做局部选项层回补，不重放整卷 explanation 重写。
- 已确认：
  - 听力区结构完整，范围为 2.01-2.05。
  - `2.03` 当前有 `24` 个占位选项，`2.04` 有 `39` 个占位选项，`2.05` 有 `8` 个占位选项。
  - `2.03/2.04` 的题级 `script` 仍保留完整题面与选项尾部，可直接按题回收。
  - `2.05 / passage 1 / question 2` 的理由项在当前 JSON 与 git 历史里都没有留存可直接回收的 option 文本；只能按现有 explanation 链与音频主线补成正式选项，但不改动 `correct_answer`。
- 本轮覆盖：
  - 已新增 `fix_n1_2011_07_listening_finalize.py`，仅处理 `2.03-2.05` 的 `options` 字段。
  - 已从 `2.03` 各题的 question script 尾部回收 `1.1 / 2.2 / 3.3 / 4.4` 占位项，恢复为实际题面选项。
  - 已从 `2.04` 各题的 question script 尾部回收 `1.1 / 2.2 / 3.3` 占位项，恢复为实际应答句。
  - 已从 `2.05 / passage 1` 的 passage script 回收 `実践タイプ / セミナータイプ / 体験タイプ / 地元タイプ` 四项。
  - 已将 `2.05 / passage 1 / question 2` 的理由项补成正式日文选项，核心保留“短期間でいろいろな企業を広く見たいから”为正确项。
  - 已将 `2.05 / passage 2` 中 `1.１番のけいたい` 这类旧式编号前缀清洗为标准选项正文。
- 本轮结果：
  - 2.01 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.02 终检通过：QCOUNT=7 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.03 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.04 终检通过：QCOUNT=13 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.05 终检通过：QCOUNT=4 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - N1_2011_07 听力整卷终检通过：RANGE=2.01-2.05 / QCOUNT=36 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0。
  - 标题规范复核通过：4+4 标题全量命中；禁用模板词归零。
  - JSON 解析正常。
- 结构备注：
  - 若 `2.03/2.04` 的 `question.script` 仍完整，而 `options` 已退化成占位值，应优先按题级 script 回收，不要误判成整段正文缺失。
  - 若 `2.05` 某个 question 的 option 文本在当前 JSON 与 git 历史中都不存在，但 explanation 已完整说明判断链，可按现有解释链补成正式选项，并在日志中明确记录为“回补”而非“原文回收”。

### N1_2011_12（回补）

- 文件：data/paper/jlpt/n1/N1_2011_12.json
- 回补背景：本卷 listening worklog 与 repo memory 都已记录整卷听力通过，但当前 JSON 的 `2.03/2.04` 又出现旧式 `options` 占位回退；`2.05` 与 explanation 主体仍保持成品状态，因此本轮只做局部选项层回补，不重放整卷 explanation 重写。
- 已确认：
  - 听力区结构完整，范围为 2.01-2.05。
  - `2.03` 当前有 `24` 个占位选项，`2.04` 有 `39` 个占位选项，`2.01/2.02/2.05` 起手已是干净状态。
  - `2.03/2.04` 全部题目的 `question.script` 都仍保留完整题面与编号选项尾部，可直接按题回收，不需要回源音频，也不需要改 explanation / explanation_expand。
- 本轮覆盖：
  - 已新增 `fix_n1_2011_12_listening_finalize.py`，仅处理 `2.03-2.04` 的 `options` 字段。
  - 已从 `2.03` 各题的 question script 尾部回收 `1.1 / 2.2 / 3.3 / 4.4` 占位项，恢复为实际题面选项。
  - 已从 `2.04` 各题的 question script 尾部回收 `1.1 / 2.2 / 3.3` 占位项，恢复为实际应答句。
  - 已统一清洗全角编号前缀，不改动任何题目的 `correct_answer` 与 explanation 主体。
- 本轮结果：
  - 2.01 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.02 终检通过：QCOUNT=7 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.03 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.04 终检通过：QCOUNT=13 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.05 终检通过：QCOUNT=4 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - N1_2011_12 听力整卷终检通过：RANGE=2.01-2.05 / QCOUNT=36 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0。
  - 标题规范复核通过：4+4 标题全量命中；禁用模板词归零。
  - JSON 解析正常。
- 结构备注：
  - 若 regression 只落在 `2.03/2.04` 的 `options` 字段，而题级 script 仍完整，应优先做 question-script 级回收脚本，不要把问题扩大成整卷重写。
  - 回补后要立刻复扫整卷 `2.01-2.05`，确认没有把原本干净的 `2.05` 一并带脏。

### N1_2012_07（回补）

- 文件：data/paper/jlpt/n1/N1_2012_07.json
- 回补背景：本卷 listening worklog 与 repo memory 都已记录整卷听力通过，但当前 JSON 的 `2.01/2.03/2.04` 又出现旧式 `options` 回退；其中 `2.01 / question 1` 是图题，占位项不在 script 尾部，`2.05` 则仍保持上次确认后的单题结构和成品状态，因此本轮只做局部选项层回补，不重放整卷 explanation 重写。
- 已确认：
  - 听力区结构完整，范围为 2.01-2.05，总题数仍为 `35`。
  - `2.01` 当前有 `4` 个占位选项，且集中在 `question 1`；`2.03` 当前有 `24` 个占位选项，`2.04` 有 `39` 个占位选项。
  - `2.03/2.04` 全部题目的 `question.script` 都仍保留完整题面与编号选项尾部，可直接按题回收。
  - `2.01 / question 1` 当前 script 只保留药物说明正文，不含图中四个可视选项；该题需结合本地题图与现有 explanation 链手工补回文本选项。
  - `2.05 / passage 1` 继续按已确认的真实单题结构保留，不恢复旧 ghost question object。
- 本轮覆盖：
  - 已新增 `fix_n1_2012_07_listening_finalize.py`，仅处理 `2.01/2.03/2.04` 的 `options` 字段。
  - 已为 `2.01 / question 1` 手工回填图题四个文本选项：`黒+白`、`黒のみ`、`黒+小容器`、`白のみ` 对应的正式日文动作表述。
  - 已从 `2.03` 各题的 question script 尾部回收 `1.1 / 2.2 / 3.3 / 4.4` 占位项，恢复为实际题面选项。
  - 已从 `2.04` 各题的 question script 尾部回收 `1.1 / 2.2 / 3.3` 占位项，恢复为实际应答句。
  - 已统一清洗编号前缀，不改动任何题目的 `correct_answer`、explanation 主体与 `2.05` 结构。
- 本轮结果：
  - 2.01 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.02 终检通过：QCOUNT=7 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.03 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.04 终检通过：QCOUNT=13 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.05 终检通过：QCOUNT=3 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - N1_2012_07 听力整卷终检通过：RANGE=2.01-2.05 / QCOUNT=35 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0。
  - 标题规范复核通过：4+4 标题全量命中；禁用模板词归零。
  - JSON 解析正常。
- 结构备注：
  - 若 `2.01` 是图题且 script 不含可解析选项，但题图与 explanation 已完整说明正确动作关系，可优先按题图 + explanation 手工补回文本选项，不必因此重做整段 explanation。
  - 若 `2.03/2.04` 的 regression 只是 `options` 回退，而题级 script 仍完整，优先做窄范围回写；复验时务必带上 `2.05`，确认先前修掉的 ghost 结构没有回潮。

### N1_2014_12（回补）

- 文件：data/paper/jlpt/n1/N1_2014_12.json
- 回补背景：本卷 worklog 里虽已记录整卷听力通过与深度精修，但当前 JSON 的 `2.03/2.04` 再次退回旧式 `options` 占位，`2.05 / passage 1` 也回到了占位选项加多挂 `question 2` 的旧结构。本轮只做局部结构回补，不重放 explanation 重写。
- 已确认：
  - 听力区 explanation / explanation_expand 仍保持成品状态，范围为 2.01-2.05。
  - `2.03` 当前有 `24` 个占位选项，`2.04` 有 `42` 个占位选项，且两节题级 script 均完整保留编号选项尾部。
  - `2.05 / passage 1` 的题头提示语是单数 `質問と選択肢`，passage script 尾部也只有一组问句与四个鸟类选项，因此当前挂出的第二个 question object 属于 ghost 结构，不应保留。
  - `2.05 / passage 2` 当前两题选项正文仍完好，不需要回写。
- 本轮覆盖：
  - 已新增 `fix_n1_2014_12_listening_finalize.py`，仅处理 `2.03/2.04/2.05` 的 `options` 与 `2.05` 结构归位。
  - 已从 `2.03` 各题 question script 尾部回收 `1.1 / 2.2 / 3.3 / 4.4` 占位项，恢复为实际题面选项。
  - 已从 `2.04` 各题 question script 尾部回收 `1.1 / 2.2 / 3.3` 占位项，恢复为实际应答句。
  - 已从 `2.05 / passage 1` 的 passage-level script 回收唯一一组鸟类选项，并删除当前多挂的 ghost `question 2`，使该 passage 回到真实单题结构。
  - 未改动任何题目的 `correct_answer`、explanation 主体与 `2.05 / passage 2` 正常题目。
- 本轮结果：
  - 2.01 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.02 终检通过：QCOUNT=7 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.03 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.04 终检通过：QCOUNT=14 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.05 终检通过：QCOUNT=3 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - N1_2014_12 听力整卷终检通过：RANGE=2.01-2.05 / QCOUNT=36 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0。
  - 标题规范复核通过：4+4 标题全量命中；禁用模板词归零。
  - JSON 解析正常。
- 结构备注：
  - 若 `2.05` 的 passage 提示语是单数 `質問と選択肢`，且 script 尾部也只有一组问句 + 一组选项，应优先判定真实结构为单题 passage，不要为维持旧题量硬留 ghost question object。
  - `2.05` 当前 question 级 `script` 为空时，先看 passage-level `script` 能否直接回收选项，再决定是否需要进一步人工重建。

### N1_2015_07（回补）

- 文件：data/paper/jlpt/n1/N1_2015_07.json
- 回补背景：本卷 worklog 已记录整卷听力 explanation 通过，但当前 JSON 的 `2.03/2.04/2.05` 出现旧式 `options` 回退；其中 `2.05 / passage 2` 不是空占位，而是 `1.1番の食品` 这类重复编号前缀残留。本轮仅做选项层回补与前缀清洗，不重放 explanation 重写。
- 已确认：
  - 听力区 explanation / explanation_expand 仍保持成品状态，范围为 2.01-2.05，总题数仍为 `37`。
  - `2.03` 当前有 `24` 个占位选项，`2.04` 有 `42` 个占位选项，且两节题级 script 均完整保留编号选项尾部。
  - `2.05 / passage 1` 两题 question script 都保留完整问句与四个编号选项，可按题直接回收。
  - `2.05 / passage 2` 两题没有可直接回收的题尾选项，但当前 `options` 保留了可用正文，只需把 `1.1番 / 2.2番 / 3.3番 / 4.4番` 规范成正式 `1番 / 2番 / 3番 / 4番` 表述。
- 本轮覆盖：
  - 已新增 `fix_n1_2015_07_listening_finalize.py`，仅处理 `2.03/2.04/2.05` 的 `options` 字段。
  - 已从 `2.03` 各题 question script 尾部回收 `1.1 / 2.2 / 3.3 / 4.4` 占位项，恢复为实际题面选项。
  - 已从 `2.04` 各题 question script 尾部回收 `1.1 / 2.2 / 3.3` 占位项，恢复为实际应答句。
  - 已从 `2.05 / passage 1` 两题的 question script 回收四个正式选项。
  - 已将 `2.05 / passage 2` 两题的 `1.1番の食品` 类畸形前缀清洗为正式 `1番の食品` 表述，不改动题目判断链。
- 本轮结果：
  - 2.01 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.02 终检通过：QCOUNT=7 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.03 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.04 终检通过：QCOUNT=14 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.05 终检通过：QCOUNT=4 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - N1_2015_07 听力整卷终检通过：RANGE=2.01-2.05 / QCOUNT=37 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0。
  - 畸形编号前缀复核通过：`1.1 / 2.2 / 3.3 / 4.4` 与 `1.1番 / 2.2番 / 3.3番 / 4.4番` 均归零。
  - JSON 解析正常。
- 结构备注：
  - 若 `2.05` 没有可回收的题尾选项，但当前选项正文仍存在，只是带有重复编号前缀，应优先做前缀归一化，不要误判成整题缺源。
  - 回补后除常规 `PLACEHOLDER_OPTS` 之外，还要额外复扫一次 `1.1番` 这类畸形前缀，避免“看似有文字、实际仍未出版化”的残留漏网。

### N1_2015_12（回补）

- 文件：data/paper/jlpt/n1/N1_2015_12.json
- 回补背景：本卷 worklog 已记录整卷听力通过，但当前 JSON 的 `2.03/2.04` 再次退回旧式 `options` 占位，`2.05 / passage 1` 也回到了占位选项加旧 `question 2` 说明条目的状态。本轮按当前文件、git 历史与本地音频重新核定结构，只做局部选项层回补与结构纠偏，不重放 explanation 重写。
- 已确认：
  - 听力区 explanation / explanation_expand 仍保持成品状态，范围为 2.01-2.05。
  - `2.03` 当前有 `24` 个占位选项，`2.04` 有 `42` 个占位选项，且两节题级 script 均完整保留编号选项尾部。
  - `2.05 / passage 1` 的提示语是单数 `質問と選択肢を聞いて`，passage script 尾部也只保留了一组问句与四个店名选项。
  - `2.05 / passage 1 / question 2` 在当前 git 历史中从未有过真实题干或选项；本地 `2015年12月N1真题_2.05_01.mp3` 也在第一问后即告截断，不存在可回收的第二问题尾，因此该对象应视为旧 ghost 条目而非真实缺尾题。
  - `2.05 / passage 2` 两题当前选项与 explanation 主体均保持干净，不需要改动。
- 本轮覆盖：
  - 已新增 `fix_n1_2015_12_listening_finalize.py`，仅处理 `2.03/2.04/2.05` 的 `options` 字段与 `2.05 / passage 1` 结构归位。
  - 已从 `2.03` 各题 question script 尾部回收 `1.1 / 2.2 / 3.3 / 4.4` 占位项，恢复为实际题面选项。
  - 已从 `2.04` 各题 question script 尾部回收 `1.1 / 2.2 / 3.3` 占位项，恢复为实际应答句。
  - 已从 `2.05 / passage 1` 的 passage-level script 回收唯一一组店铺选项：`小道 / 郷土 / 花 / 祭り`。
  - 已删除 `2.05 / passage 1` 中旧的 ghost `question 2`，使该 passage 回到真实单题结构。
- 本轮结果：
  - 2.01 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.02 终检通过：QCOUNT=7 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.03 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.04 终检通过：QCOUNT=14 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.05 终检通过：QCOUNT=3 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - N1_2015_12 听力整卷终检通过：RANGE=2.01-2.05 / QCOUNT=36 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0。
  - 畸形编号前缀复核通过：`1.1 / 2.2 / 3.3 / 4.4` 与 `1.1番` 类残留均归零。
  - JSON 解析正常。
- 结构备注：
  - 若 `2.05` 的 passage 提示语明确是单数 `質問と選択肢`，且本地 script / git 历史 / 音频都只支持一组问句与一组选项，就应把额外挂着的第二题判定为 ghost 对象删除，而不是长期以“缺尾题”形式保留。
  - 对这类纠偏卷，整卷终检应以当前真实结构记账；本卷 `2.05` 的正确结构为 `1+2`，整卷总题数应为 `36` 而不是旧日志里的 `37`。

### N1_2016_07（回补）

- 文件：data/paper/jlpt/n1/N1_2016_07.json
- 回补背景：本卷 worklog 已记录整卷听力 explanation 通过，但当前 JSON 的 `2.03/2.04/2.05` 又回到旧式 `options` 退化状态；其中 `2.05 / passage 1` 挂着占位选项和旧 `question 2` 说明条目，`2.05 / passage 2` 则保留了 `1.1冊目` 一类重复编号前缀。本轮按当前文件结构做局部选项层回补与结构纠偏，不重放 explanation 重写。
- 已确认：
  - 听力区 explanation / explanation_expand 仍保持成品状态，范围为 2.01-2.05。
  - `2.03` 当前有 `24` 个占位选项，`2.04` 有 `42` 个占位选项，且两节题级 script 均完整保留编号选项尾部。
  - `2.05 / passage 1` 的提示语是单数 `質問と選択肢を聞いて`，passage script 尾部也只保留了一组问句与四个课程名选项，因此当前第二个 question object 仍应判定为 ghost 条目。
  - `2.05 / passage 2` 两题 question / passage script 都不含可直接回收的编号选项，但当前 `options` 正文仍在，只是被污染成 `1.1冊目 / 2.2冊目 / 3.3冊目 / 4.4冊目`。
- 本轮覆盖：
  - 已新增 `fix_n1_2016_07_listening_finalize.py`，仅处理 `2.03/2.04/2.05` 的 `options` 字段与 `2.05 / passage 1` 结构归位。
  - 已从 `2.03` 各题 question script 尾部回收 `1.1 / 2.2 / 3.3 / 4.4` 占位项，恢复为实际题面选项。
  - 已从 `2.04` 各题 question script 尾部回收 `1.1 / 2.2 / 3.3` 占位项，恢复为实际应答句。
  - 已从 `2.05 / passage 1` 的 passage-level script 回收唯一一组课程选项：`経済入門 / 経済学概論 / 経営学 / 西洋経済史`。
  - 已删除 `2.05 / passage 1` 中旧的 ghost `question 2`，使该 passage 回到真实单题结构。
  - 已将 `2.05 / passage 2` 两题的 `1.1冊目` 类畸形前缀清洗为正式 `1冊目 / 2冊目 / 3冊目 / 4冊目` 表述，不改动题目判断链。
- 本轮结果：
  - 2.01 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.02 终检通过：QCOUNT=7 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.03 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.04 终检通过：QCOUNT=14 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.05 终检通过：QCOUNT=3 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - N1_2016_07 听力整卷终检通过：RANGE=2.01-2.05 / QCOUNT=36 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0。
  - 畸形编号前缀复核通过：`1.1 / 2.2 / 3.3 / 4.4`、`1.1冊目 / 2.2冊目 / 3.3冊目 / 4.4冊目` 均归零。
  - JSON 解析正常。
- 结构备注：
  - 若 `2.05` 的 passage 提示语是单数 `質問と選択肢`，且 script 尾部也只支持一组问句 + 一组选项，应优先按真实 `1+2` 结构记账，不要继续保留旧 ghost question。
  - 若 `2.05` 某题没有可回收的题尾选项，但当前选项正文本身仍有内容，只是带着重复编号前缀，应优先做前缀归一化，不必把该题扩大成“缺源需重建”。

### N3_2010_07

- 文件：data/paper/jlpt/n3/N3_2010_07.json
- 起手基线：听力区 `2.01-2.05` 共 `28` 题；按当前听力出版物 `4+4` 与选项退化口径复扫，起手为 `WARN=0 / PLACEHOLDER=55 / MALFORMED=56 / PREFIXED=99 / ISSUES=56`。
- 已确认：
  - 听力区结构完整，范围为 `2.01-2.05`。
  - 原有 explanation / explanation_expand 大量停留在旧 N3 听力标题体系，需整卷统一切回当前 `4+4` 成品口径。
  - `2.01 / question 1` 是图题，当前 JSON 不挂题图路径，真实选项需结合本地题图 `data/image/jlpt/n3/2010_07_N3_2.01_Q01.jpg` 回收。
  - `2.03-2.05` 的真实选项语义可从当前 question script 或即时应答题面直接恢复，不需要回源音频。
- 本轮覆盖：
  - 已新增 `scripts/scan_n3_listening_publication.py`，用于统一复扫 N3 听力区 `2.01-2.05` 的 `4+4` 标题、总字数、比例、禁用信号与选项退化。
  - 已新增 `scripts/fix_n3_2010_07_listening_finalize.py`，用于按 section 定向回写当前卷听力成品稿。
  - 已完成 `2.01-1` 至 `2.01-6` explanation / explanation_expand 重写，并为 `2.01 / question 1` 回填图题四个正式选项。
  - 已完成 `2.02-1` 至 `2.02-6` explanation / explanation_expand 重写，并清洗旧式编号前缀残留。
  - 已完成 `2.03-1` 至 `2.03-3` explanation / explanation_expand 重写，并从 question script 回收四项正式选项。
  - 已完成 `2.04-1` 至 `2.04-4` explanation / explanation_expand 重写，并从题面恢复即时应答三选项。
  - 已完成 `2.05-1` 至 `2.05-9` explanation / explanation_expand 重写，并从 script 回收三选项应答句。
  - 已统一清洗全卷 `1.1 / 2.2 / 3.3 / 4.4`、`1.四時`、`1.400円` 一类旧式编号前缀与占位残留。
- 本轮结果：
  - `2.01` 终检通过：`QCOUNT=6 / WARN=0 / PLACEHOLDER=0 / MALFORMED=0 / PREFIXED=0 / ISSUES=0`。
  - `2.02` 终检通过：`QCOUNT=6 / WARN=0 / PLACEHOLDER=0 / MALFORMED=0 / PREFIXED=0 / ISSUES=0`。
  - `2.03` 终检通过：`QCOUNT=3 / WARN=0 / PLACEHOLDER=0 / MALFORMED=0 / PREFIXED=0 / ISSUES=0`。
  - `2.04` 终检通过：`QCOUNT=4 / WARN=0 / PLACEHOLDER=0 / MALFORMED=0 / PREFIXED=0 / ISSUES=0`。
  - `2.05` 终检通过：`QCOUNT=9 / WARN=0 / PLACEHOLDER=0 / MALFORMED=0 / PREFIXED=0 / ISSUES=0`。
  - `N3_2010_07` 听力整卷终检通过：`RANGE=2.01-2.05 / QCOUNT=28 / WARN=0 / PLACEHOLDER=0 / MALFORMED=0 / PREFIXED=0 / HEADING_ISSUES=0`。
  - JSON 解析正常；当前听力 `4+4` 标题全量命中。
- 结构备注：
  - `2.01 / question 1` 的真实选项不在当前 JSON script 内，后续若再遇到同类 N3 图题，应优先查本地题图目录，不要误判成整题缺源。
  - 对 N3 旧卷，`2.03-2.05` 常见退化形态不是 explanation 缺失，而是“旧标题 + 占位选项 + 编号前缀残留”叠加；复验时必须同时扫 `PLACEHOLDER / MALFORMED / PREFIXED / HEADING_ISSUES` 四类信号。
  - `scripts/fix_n3_2010_07_listening_finalize.py` 的 `normalize_block` 已修正为 `dedent + strip`；否则多行稿件前导缩进会被写回 JSON，造成伪标题命中失败与总字数虚高。

### N3_2011_07

- 文件：data/paper/jlpt/n3/N3_2011_07.json
- 起手基线：听力区 `2.01-2.05` 共 `27` 题；按当前听力出版物 `4+4` 与选项退化口径复扫，起手为 `WARN=0 / PLACEHOLDER=48 / MALFORMED=50 / PREFIXED=96 / ISSUES=54`。
- 已确认：
  - 听力区结构完整，范围为 `2.01-2.05`。
  - `2.01-2.02` 的主要问题是旧标题与编号前缀残留，不是题源缺失。
  - `2.02` 存在“前缀后仍带真实数字正文”的坏值，如 `2.2回目...`、`3.1か月後...`；清洗时必须只去掉外层选项编号，保留正文里的真实数字。
  - `2.03-2.05` 的真实选项都已保留在当前 question script 或即时应答题面内，可直接回收，不需要回源音频。
- 本轮覆盖：
  - 已新增 `scripts/fix_n3_2011_07_listening_finalize.py`，用于按 section 定向回写当前卷听力成品稿。
  - 已完成 `2.01-1` 至 `2.01-6` explanation / explanation_expand 重写，并清洗图表题与文本题中的编号前缀残留。
  - 已完成 `2.02-1` 至 `2.02-6` explanation / explanation_expand 重写，并修正 `2.2回目`、`3.1か月後` 一类畸形前缀。
  - 已完成 `2.03-1` 至 `2.03-3` explanation / explanation_expand 重写，并从 question script 回收四项正式选项。
  - 已完成 `2.04-1` 至 `2.04-4` explanation / explanation_expand 重写，并回填即时应答三选项。
  - 已完成 `2.05-1` 至 `2.05-8` explanation / explanation_expand 重写，并从 script 回收三选项应答句。
- 本轮结果：
  - `2.01` 终检通过：`QCOUNT=6 / WARN=0 / PLACEHOLDER=0 / MALFORMED=0 / PREFIXED=0 / ISSUES=0`。
  - `2.02` 终检通过：`QCOUNT=6 / WARN=0 / PLACEHOLDER=0 / MALFORMED=0 / PREFIXED=0 / ISSUES=0`。
  - `2.03` 终检通过：`QCOUNT=3 / WARN=0 / PLACEHOLDER=0 / MALFORMED=0 / PREFIXED=0 / ISSUES=0`。
  - `2.04` 终检通过：`QCOUNT=4 / WARN=0 / PLACEHOLDER=0 / MALFORMED=0 / PREFIXED=0 / ISSUES=0`。
  - `2.05` 终检通过：`QCOUNT=8 / WARN=0 / PLACEHOLDER=0 / MALFORMED=0 / PREFIXED=0 / ISSUES=0`。
  - `N3_2011_07` 听力整卷终检通过：`RANGE=2.01-2.05 / QCOUNT=27 / WARN=0 / PLACEHOLDER=0 / MALFORMED=0 / PREFIXED=0 / HEADING_ISSUES=0`。
  - JSON 解析正常；当前听力 `4+4` 标题全量命中。
- 结构备注：
  - 若旧前缀清洗后仍剩下 `2回目`、`1か月後` 这类以数字开头的真实正文，不要再把它误判成占位值；这类数字属于选项内容本体。
  - 本卷 `2.05` 是单 passage 的 8 题即时应答组；后续 N3 同型卷可优先先判清 question 数和 script 组织方式，再决定回写粒度。

### N3_2011_12

- 文件：data/paper/jlpt/n3/N3_2011_12.json
- 起手基线：听力区 `2.01-2.05` 共 `27` 题；按当前听力出版物 `4+4` 与选项退化口径复扫，起手为 `WARN=0 / PLACEHOLDER=56 / MALFORMED=56 / PREFIXED=96 / ISSUES=54`。
- 已确认：
  - 听力区结构完整，范围为 `2.01-2.05`。
  - `2.01` 为混合源：`Q2 / Q3 / Q5` 的正式选项需结合本地图题恢复，不宜把占位值直接当缺源。
  - 本地已核用题图：`data/image/jlpt/n3/2011_12_N3_2.01_Q02.jpg`、`data/image/jlpt/n3/2011_12_N3_2.01_Q03.jpg`、`data/image/jlpt/n3/2011_12_N3_2.01_Q05.jpg`。
  - `2.03-2.05` 的真实选项都保留在当前 question script 或即时应答题面中，可直接回收，不需要回源音频。
- 本轮覆盖：
  - 已新增 `scripts/fix_n3_2011_12_listening_finalize.py`，用于按当前卷剩余缺口定向回写听力成品稿。
  - 已完成 `2.01-1` 至 `2.01-6` explanation / explanation_expand 重写，并恢复图题与文本题的正式选项。
  - 已完成 `2.02-1` 至 `2.02-6` explanation / explanation_expand 重写，并清洗旧式编号前缀残留。
  - 已完成 `2.03-1` 至 `2.03-3` explanation / explanation_expand 重写，并从 question script 回收四项正式选项。
  - 已完成 `2.04-1` 至 `2.04-4` explanation / explanation_expand 重写，并回填即时应答三选项。
  - 已完成 `2.05-1` 至 `2.05-8` explanation / explanation_expand 重写，并从 script 回收三选项应答句。
- 本轮结果：
  - `2.01` 终检通过：`QCOUNT=6 / WARN=0 / PLACEHOLDER=0 / MALFORMED=0 / PREFIXED=0 / ISSUES=0`。
  - `2.02` 终检通过：`QCOUNT=6 / WARN=0 / PLACEHOLDER=0 / MALFORMED=0 / PREFIXED=0 / ISSUES=0`。
  - `2.03` 终检通过：`QCOUNT=3 / WARN=0 / PLACEHOLDER=0 / MALFORMED=0 / PREFIXED=0 / ISSUES=0`。
  - `2.04` 终检通过：`QCOUNT=4 / WARN=0 / PLACEHOLDER=0 / MALFORMED=0 / PREFIXED=0 / ISSUES=0`。
  - `2.05` 终检通过：`QCOUNT=8 / WARN=0 / PLACEHOLDER=0 / MALFORMED=0 / PREFIXED=0 / ISSUES=0`。
  - `N3_2011_12` 听力整卷终检通过：`RANGE=2.01-2.05 / QCOUNT=27 / WARN=0 / PLACEHOLDER=0 / MALFORMED=0 / PREFIXED=0 / HEADING_ISSUES=0`。
  - JSON 解析正常；当前听力 `4+4` 标题全量命中。
- 结构备注：
  - 图题若同时存在本地题图与 script 文本，优先以题图补齐缺失选项，再用 script 校对语义，不要把图题直接套成普通文本题。
  - 本卷 `2.05` 同样是单 passage 的 8 题即时应答组；后续遇到 N3 同型卷，仍可先按单段应答组处理，再做整卷复扫。

### N3_2016_12

- 文件：data/paper/jlpt/n3/N3_2016_12.json
- 回补背景：本卷听力 `2.01-2.05` 的 explanation / explanation_expand 字数、比例与 `4+4` 标题已基本达标，但按当前出版物禁用信号复扫时，`28 / 28` 题仍命中“答案是”与反引号残留；其中 `2.05` 的 `9 / 9` 题全部带同型残留，需做一轮成品级收口。
- 已确认：
  - 听力区结构完整，范围为 `2.01-2.05`，总题数为 `28`。
  - 起手问题不在题型判断或长度失衡，而在成品口吻残留：主解析里仍有“正确答案是”，补充层与局部误选分析里仍残留反引号包裹的日语表达。
  - `2.05 / Q9` 原本处在总字数下沿；清掉残留标记后会跌出下限，因此必须把补字放回句内，不能只做机械删改。
- 本轮覆盖：
  - 已新增 `scripts/fix_n3_2016_12_listening_finalize.py`，只定向处理 `2.01-2.05` 的 publication residue，并在脚本内联校验标题、总字数、比例与禁用信号。
  - 已将听力区 explanation 中的“正确答案是”统一收口为出版物可用说法“最合适的是”，避免保留流程句口吻。
  - 已将听力区 explanation / explanation_expand 内的反引号统一改为中文引号，保留原有语义与字数框架，不动题外字段。
  - 已对 `2.05 / Q9` 做句内微调，把总字数从清理后的 `625` 拉回 `630`，并维持 explanation / explanation_expand `315 / 315` 的平衡比例。
- 本轮结果：
  - 执行 `scripts/fix_n3_2016_12_listening_finalize.py` 成功：`updated_fields=40 / questions=28 / issues=0`。
  - `2.05` 终检通过：`QCOUNT=9 / ISSUES=0`。
  - `N3_2016_12` 听力整卷终检通过：`RANGE=2.01-2.05 / QCOUNT=28 / ISSUE_Q=0`。
  - 当前复扫口径同时覆盖 `4+4` 标题、总字数 `630-670`、主补比例 `0.90-1.11` 与出版物禁用信号；JSON 解析正常。
- 结构备注：
  - 这类“内容已成型、只剩 publication residue”的卷面，不要直接按旧 PASS 记账，必须以当前 JSON 实物再扫一次反引号与流程句。
  - 即時応答题的边界题常卡在总字数下沿；替换禁用信号时若会掉出 `630`，优先做句内等义补偿，不要用句尾硬塞语气词。

### N1 听力编号前缀批量回补（补记）

- 回补背景：在本轮对 `N1` 听力区做更严格复扫时，发现仅用 `PLACEHOLDER_OPTS / HEADING_ISSUES` 口径会漏掉一类“看起来已有正文、但仍未出版化”的回退：整题四个 `options` 同时残留 `1.` / `2.` / `3.` / `4.` 编号前缀。旧 worklog 中多卷已记为 PASS，但当前 JSON 里这类前缀仍存在，因此本轮以当前文件状态为准做一次批量回补。
- 本轮范围：
  - 先局部修正 `N1_2023_12` 的听力选项前缀残留。
  - 随后追加全量严格扫描，确认 `N1_2010_07`、`N1_2010_12`、`N1_2011_07`、`N1_2011_12`、`N1_2012_07`、`N1_2012_12`、`N1_2013_07`、`N1_2013_12`、`N1_2014_07`、`N1_2014_12`、`N1_2015_07`、`N1_2015_12`、`N1_2016_07`、`N1_2016_12`、`N1_2017_07`、`N1_2017_12`、`N1_2018_07`、`N1_2018_12`、`N1_2019_07`、`N1_2019_12`、`N1_2020_12`、`N1_2021_07`、`N1_2021_12`、`N1_2022_07`、`N1_2022_12`、`N1_2023_07`、`N1_2024_07`、`N1_2024_12` 也存在同型回退。
- 已确认：
  - 所有命中的 listening question 都是“整题四项同时带前缀”，不存在单题内只脏一部分的混合结构，因此可安全按 `options` 层统一清洗。
  - 这类回退主要表现为 `1.地元で取れる大豆...`、`2.10年かけて...`、`1.ひかり`、`1.10,000円` 等；去掉首个编号前缀后，正文即可恢复为出版物口径，不需要重写 explanation 主体。
- 本轮覆盖：
  - 已新增 `scripts/fix_n1_2023_12_listening_option_prefixes.py`，先对 `N1_2023_12` 做局部验证式回补。
  - 已新增 `scripts/fix_n1_listening_option_prefixes.py`，对 `N1` 全量听力区执行统一的 `options` 前缀清洗，仅移除首个 `1.` / `2.` / `3.` / `4.` 前缀，不改动 `correct_answer`、explanation 或 `2.05` 结构。
  - 已将 `N1_2010_07 / 2.01 / Q6` 中 `1.10,000円 / 2.8,000円 / 3.2,000円 / 4.1,000円` 这类显性坏值一并纠正为标准金额正文。
- 本轮结果：
  - 严格复扫通过：`N1` 全量听力 JSON 当前 `TOTAL_FAILING=0`。
  - 复扫口径同时包含 `WARN`、`PLACEHOLDER_OPTS`、旧模板标题、`1.1 / 2.2 / 3.3 / 4.4` 类畸形前缀，以及更宽口径的 `1.` / `2.` / `3.` / `4.` 正文前缀残留。
  - `N1_2010_07` 个别显性坏值修复后整卷听力复核为 `QCOUNT=37 / WARN=0 / PLACEHOLDER=0 / MALFORMED=0 / ISSUES=0`。
  - `N1_2023_12` 局部修复后整卷听力复核为 `QCOUNT=30 / WARN=0 / PLACEHOLDER=0 / MALFORMED=0 / PREFIXED=0 / ISSUES=0`。
- 结构备注：
  - 后续凡是“已通过卷”再次复核时，除常规 `PLACEHOLDER_OPTS` / 旧模板标题之外，还要额外复扫一次 listening `options` 是否残留整组编号前缀；否则会漏掉这种“题干解释已完成、选项正文仍未出版化”的回退。

### N1_2022_12（回补）

- 文件：data/paper/jlpt/n1/N1_2022_12.json
- 回补背景：listening worklog 旧条目曾记录本卷听力整卷通过，但本轮按当前 JSON 复核时，`2.01-2.05` 共 30 题已整体回退到旧式听力模板，`explanation / explanation_expand` 不再符合当前听力 `4+4` 成品口径。因此本轮以当前文件状态为准，重做整卷听力 explanation 成品回补，并重新验收。
- 已确认：
  - 听力区结构完整，范围为 `2.01-2.05`，总题数仍为 `30`。
  - `2.01-2.04` 的证据链主要落在 `question.script`；`2.05` 的证据链落在 `passage.script`。
  - 起手旧模板标题为 `【正确项解析】 / 【重点词汇】 / 【关键句提示】 / 【结论句】` 与 `【干扰项分析】 / 【考点直击】 / 【原文大意】 / 【做题技巧】`，与当前标准不一致。
  - `2.05` 存在跨 passage 复用 `question.id=1` 的情况；若使用脚本做局部 finalize，必须以 `section + passage + question` 共同定位，不能只靠 `section + question`。
- 本轮覆盖：
  - 已完成 `2.01-2.05` 全量 `explanation / explanation_expand` 重写，统一到当前听力 `4+4` 标题与出版物口径。
  - 已新增 `scripts/fix_n1_2022_12_listening_finalize.py`，用于对当前卷做局部、可重复执行的 finalize 回写；后续扩展时已补齐对 `2.05` 的 passage 级定位支持。
  - 已按 section 窄验收顺序完成 `2.01`、`2.02`、`2.03`、`2.04`、`2.05` 的逐段清洗与回写，避免大 JSON 直接反复 patch 漂移。
  - 已将 `2.05 / passage 1 / question 1` 重写为“多方案筛选后最终定案”的正式解析；已将 `2.05 / passage 2 / question 1-2` 分别重写为双人物分流选择的正式解析。
- 本轮结果：
  - `2.01` 终检通过：`QCOUNT=5 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.02` 终检通过：`QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.03` 终检通过：`QCOUNT=5 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.04` 终检通过：`QCOUNT=11 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `2.05` 终检通过：`QCOUNT=3 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0`。
  - `N1_2022_12` 听力整卷终检通过：`RANGE=2.01-2.05 / QCOUNT=30 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0`。
  - 旧模板标题复核通过：`【正确项解析】`、`【重点词汇】`、`【关键句提示】`、`【结论句】`、`【干扰项分析】`、`【考点直击】`、`【原文大意】`、`【做题技巧】` 当前计数均为 `0`。
  - JSON 解析正常。
- 结构备注：
  - 若 worklog 旧条目显示“已通过”，但当前 JSON 明显回退，应始终以当前文件状态为准，不沿用历史通过结论。
  - `2.05` 若存在跨 passage 复用 question id 的情况，局部修复脚本必须带上 `passage.id` 做精确定位，否则容易误覆盖到同 section 的另一题。

### N1_2019_07（回补）

- 文件：data/paper/jlpt/n1/N1_2019_07.json
- 回补背景：旧 worklog 已记录本卷听力整卷通过，但当前 JSON 复核显示 `2.04` 仍残留 1 处选项层退化：`passage 1 / question 3` 的应答选项被污染成带编号残影的 `1.2、3分でいいですか。 / 2.もちろん差し上げますよ。 / 3.李さんから挨拶あるんですね。`，且 explanation 同步留下了截断引用 `第1项「分でいいですか。」`。本轮仅对该题做最小归一化，并在修复过程中顺带恢复了一次误补丁造成的文件头 JSON 分隔符损坏。
- 已确认：
  - 听力区 explanation / explanation_expand 在 `2.01-2.05` 其余题目仍保持成品状态。
  - 当前卷唯一脏点集中在 `2.04 / passage 1 / question 3`；除该题外，其余 listening 题面均无占位项、警告标记或标题缺失。
  - 该题 script 中保留的 `1.2、3分でいいですか。` 属于原始朗读编号文本，不应直接原样落入 `options`；正式选项正文应去除编号残影后再做自然化处理。
- 本轮覆盖：
  - 已修复误补丁带来的文件头对象分隔符缺失，恢复 `N1_2019_07.json` 为可解析状态。
  - 已将 `2.04 / passage 1 / question 3` 的三项正式选项归一化为：`二、三分でいいですか。 / もちろん差し上げますよ。 / 李さんから挨拶あるんですね。`。
  - 已同步修正 explanation 中的正确项引用为 `第1项「二、三分でいいですか。」`，保持题面与解析引用一致。
- 本轮结果：
  - 2.01 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.02 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.03 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.04 终检通过：QCOUNT=13 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.05 终检通过：QCOUNT=4 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - N1_2019_07 听力整卷终检通过：RANGE=2.01-2.05 / QCOUNT=35 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0。
  - 畸形编号残影复核通过：`options` 中 `1.2、3分でいいですか。 / 2.もちろん差し上げますよ。 / 3.李さんから挨拶あるんですね。` 已归零；script 原始编号文本保留不动。
  - JSON 解析正常。
- 结构备注：
  - 对应答句类题目，若正文恰好以真实数量表达开头（如 `二、三分`），应优先做“去编号残影 + 正文自然化”处理，避免误把正文里的数字量词当成残余编号。
  - 大 JSON 做局部补丁后必须立即复跑 JSON 解析；若补丁误命中其他片段，优先先恢复语法正确性，再回到目标题做精确替换。

### N1_2020_12（回补）

- 文件：data/paper/jlpt/n1/N1_2020_12.json
- 回补背景：当前卷 listening 复核显示唯一异常集中在 `2.05 / passage 2 / question 1-2`。两题 explanation 与 script 都保持成品状态，但 `options` 数组退化成重复编号前缀 `1.1番教室 / 2.2番教室 / 3.3番教室 / 4.4番教室`，共计 `MALFORMED=8`。本轮仅做选项层归一化，不改动题意、结构和解析正文。
- 已确认：
  - `2.01 / 2.03 / 2.04` 当前均为干净状态；`2.02` 虽为 `QCOUNT=7`，但标题、警告、占位与畸形前缀均为零，属于该卷既有成品结构。
  - 脏点仅在 `2.05 / passage 2` 两题，且两题的 explanation 已经使用正式表述 `1番教室 / 2番教室 / 3番教室 / 4番教室`，说明不需要重写 explanation，只需把 `options` 恢复到同一正式文本。
  - passage script 中 `1番教室 / 2番教室 / 3番教室 / 4番教室` 的教室编号链完整保留，足以支持最小归一化处理。
- 本轮覆盖：
  - 已将 `2.05 / passage 2 / question 1` 的四个选项从 `1.1番教室 / 2.2番教室 / 3.3番教室 / 4.4番教室` 归一化为正式 `1番教室 / 2番教室 / 3番教室 / 4番教室`。
  - 已将 `2.05 / passage 2 / question 2` 的四个选项同步归一化为相同正式表述。
  - 未改动 passage script、correct_answer、explanation 与 explanation_expand，保持既有判断链不变。
- 本轮结果：
  - 2.01 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.02 终检通过：QCOUNT=7 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.03 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.04 终检通过：QCOUNT=13 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.05 终检通过：QCOUNT=3 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - N1_2020_12 听力整卷终检通过：RANGE=2.01-2.05 / QCOUNT=35 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0。
  - 畸形编号前缀复核通过：`1.1番教室 / 2.2番教室 / 3.3番教室 / 4.4番教室` 已从本卷 `options` 归零。
  - JSON 解析正常。
- 结构备注：
  - 当 explanation 已经使用正式题面，而 `options` 单独退化为重复编号前缀时，应优先做最小数组归一化，不要额外重写解析。
  - 多问同一 passage 的共用选项一旦一起退化，需两题同步修复，避免一题恢复一题残留造成同卷内部不一致。

### N1_2017_07（回补）

- 文件：data/paper/jlpt/n1/N1_2017_07.json
- 回补背景：旧 worklog 记录本卷听力 `2.05` 为双 passage 共四题且已经做过深度二轮改写，但当前 JSON 复核显示该记录已不再可靠：`2.03/2.04` 重新退回占位选项；`2.05 / passage 1` 的提示语是单数 `質問と選択肢を聞いて`，script 尾部也只保留了一组问句和一组选项；同时 `2.05` 中仍残留了几条泛模板 explanation，已不符合出版物标准。
- 已确认：
  - 听力区 explanation / explanation_expand 在 `2.01-2.04` 仍基本保持成品状态，但 `2.05` 至少有 `passage 1 / question 2`、`passage 2 / question 1`、`passage 2 / question 2` 出现模板化表述，需按当前 script 重写。
  - `2.03` 当前有 `24` 个占位选项，`2.04` 有 `39` 个占位选项，且两节题级 script 均完整保留编号选项尾部。
  - `2.05 / passage 1` 当前提示语为单数，passage script 末尾只有一条问句 `男の人はどの部屋を借りることにしましたか。` 和一组会场选项 `第一会議室 / 第二会議室 / 多目的室 / 大会議室`，因此旧 `question 2` 应判定为 ghost 条目而不是继续保留。
  - `2.05 / passage 2` 仍是完整 `2` 问结构，当前 `options` 正文未坏，但两题 explanation 已退化成泛模板，需要基于现有 script 重新写回证据链。
- 本轮覆盖：
  - 已新增 `fix_n1_2017_07_listening_finalize.py`，仅处理 `2.03/2.04/2.05` 的局部回补，不重放整卷 explanation。
  - 已从 `2.03` 各题 question script 尾部回收 `1.1 / 2.2 / 3.3 / 4.4` 占位项，恢复为实际题面选项。
  - 已从 `2.04` 各题 question script 尾部回收 `1.1 / 2.2 / 3.3` 占位项，恢复为实际应答句。
  - 已从 `2.05 / passage 1` 的 passage-level script 回收唯一一组会场选项：`第一会議室 / 第二会議室 / 多目的室 / 大会議室`。
  - 已删除 `2.05 / passage 1` 中旧的 ghost `question 2`，使该 passage 回到真实单题结构。
  - 已将 `2.05 / passage 2` 两题 explanation / explanation_expand 按当前 script 重写为成品稿：
    - question 1 明确写出男生为何从女方猜测的 `青グループ` 转向 `赤グループ`（分析调查结果并用于商品开发）。
    - question 2 明确写出女生为何不选 `緑グループ` 而选 `黄色グループ`（重点是让商品对消费者更有吸引力，对应名称与包装设计）。
- 本轮结果：
  - 2.01 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.02 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.03 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.04 终检通过：QCOUNT=13 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.05 终检通过：QCOUNT=3 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - N1_2017_07 听力整卷终检通过：RANGE=2.01-2.05 / QCOUNT=34 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0。
  - 模板残留复核通过：`关键评价维度 / 过往表现 / 通常格式为 / 对话中未提及预约问题` 等泛模板信号均归零。
  - JSON 解析正常。
- 结构备注：
  - 旧 worklog 中的 `2+2` 结构和“已深改”标签不能直接沿用；若当前 JSON 的 passage 提示语、script 尾部和题目对象数互相冲突，应以当前文件里的可证据结构为准重新记账。
  - 对 `2.05` 这类退化卷，不能只盯 `options`。如果当前 explanation 已回退成泛模板，也要按现有 script 把证据链重写回成品水位。

### N1_2017_12（回补）

- 文件：data/paper/jlpt/n1/N1_2017_12.json
- 回补背景：旧 worklog 已记录本卷整卷听力通过，但当前 JSON 复核显示 explanation 仍保持成品状态，唯一退化点只剩 `2.05 / passage 2` 的 8 个畸形编号前缀：`1.1番 / 2.2番 / 3.3番 / 4.4番` 以及组合写法 `1.1番と2番` 一类残留。
- 已确认：
  - 听力区 explanation / explanation_expand 仍保持成品状态，范围为 2.01-2.05。
  - `2.01-2.04` 当前无占位选项、无畸形前缀、无标题问题。
  - `2.05` 当前结构仍为旧 worklog 所记的真实 `2+2` 结构，整卷总题数维持 `35`。
  - 本轮 `MALFORMED=8` 全部集中在 `2.05 / passage 2`：
    - question 1 为单项景品编号，当前被污染成 `1.1番 / 2.2番 / 3.3番 / 4.4番`
    - question 2 为组合景品编号，当前被污染成 `1.1番と2番 / 1.1番と4番 / 2.2番と3番 / 3.3番と4番`
- 本轮覆盖：
  - 未改动任何 explanation / explanation_expand，只对当前坏前缀做最小归一化。
  - 已将 `2.05 / passage 2 / question 1` 选项清洗为正式 `1番 / 2番 / 3番 / 4番`。
  - 已将 `2.05 / passage 2 / question 2` 组合选项清洗为正式 `1番と2番 / 1番と4番 / 2番と3番 / 3番と4番`。
- 本轮结果：
  - 2.01 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.02 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.03 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.04 终检通过：QCOUNT=13 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.05 终检通过：QCOUNT=4 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - N1_2017_12 听力整卷终检通过：RANGE=2.01-2.05 / QCOUNT=35 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0。
  - 畸形编号前缀复核通过：`1.1番 / 2.2番 / 3.3番 / 4.4番` 与组合写法 `1.1番と2番` 类残留均归零。
  - JSON 解析正常。
- 结构备注：
  - 若当前卷已经是成品 explanation 状态，而问题只剩重复编号前缀，应优先做最小文本归一化，不要为了小问题重开 explanation 重写。
  - 组合选项同样会出现半坏前缀；清洗时只应去掉重复编号前缀，保留后半段真实组合关系不变。

### N1_2018_07（回补）

- 文件：data/paper/jlpt/n1/N1_2018_07.json
- 回补背景：旧 worklog 把本卷 `2.03` 记录为“结构性缺源、仅能保留最小闭环”，但当前 JSON 复核显示这条结论已经失效：`2.03` 六题当前都保留了完整 question script，且每题 script 尾部都带着可直接回收的四个正式选项；真正退化的是旧的最小闭环 explanation 仍留在文件里，导致 `2.03` 全段同时存在占位选项与过时的“缺源”文案。
- 已确认：
  - 听力区 explanation / explanation_expand 在 `2.01/2.02/2.04/2.05` 仍保持成品状态。
  - 当前卷唯一脏点集中在 `2.03`：`PLACEHOLDER_OPTS=24 / MALFORMED=24`。
  - `2.03` 六题都能从当前 question script 直接回收真实选项：
    - Q1 购物直觉：`必要がないものを買うと後悔する / 急いで買うと失敗する / 迷わずに買ったものは飽きない / よく考えて買ったものは長く使える`
    - Q2 移动银行：`いろいろな移動式サービスの種類 / 災害時に備えた地域の取り組み / 銀行が移動式サービスを始めたこと / 銀行同士の競争が激しくなっていること`
    - Q3 樱树病害应对：`桜祭りに来る客を増やすための対策 / 桜の木の病気に対する対応 / 桜の木を切ることに反対する運動 / 桜の木を新たに植える取り組み`
    - Q4 麦的起源：`現在栽培されている麦の始まり / 麦に関する研究の展望 / 麦を分類する方法 / 麦の突然変異の仕組み`
    - Q5 广告投放：`ウェブを中心に行うべきだ / ウェブとテレビで行うべきだ / 新聞とウェブとテレビで行うべきだ / 新聞に絞って行うべきだ`
    - Q6 老年人领养犬：`無責任に犬を捨ててはいけない / 高齢者に合った動物保護の仕方がある / 子犬も高齢者の犬も同様に保護すべきだ / 犬は高齢者に癒しを与えてくれる`
- 本轮覆盖：
  - 已新增 `fix_n1_2018_07_listening_finalize.py`，仅处理 `2.03`，不改动其他 section。
  - 已从 `2.03` 六题的 question script 尾部回收全部正式选项，清除 `1.1 / 2.2 / 3.3 / 4.4` 占位项。
  - 已将 `2.03` 六题旧的“缺源最小闭环” explanation / explanation_expand 全部重写为基于当前 script 的成品稿：
    - Q1 抓“直感で選んだ服ほど長く着る”这一主旨，纠正为“迷わずに買ったものは飽きない”。
    - Q2 抓新闻主轴“银行开始移动式服务”，排除“灾害起点/竞争目的”这类局部信息。
    - Q3 抓市长对樱树病害的处理链条，而不是误判成樱花祭或植树主题。
    - Q4 抓当前栽培麦的起源，而不是研究方法或突变机制局部。
    - Q5 抓“高龄顾客 + 预算集中”后落到“新聞に絞る”。
    - Q6 抓“老年人也有适合自己的领养方式”，而不是泛泛谈弃养或疗愈。
- 本轮结果：
  - 2.01 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.02 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.03 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.04 终检通过：QCOUNT=13 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.05 终检通过：QCOUNT=4 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - N1_2018_07 听力整卷终检通过：RANGE=2.01-2.05 / QCOUNT=35 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0。
  - 旧缺源残留复核通过：`当前源数据未提供本题可用原文 / 本题属于「概要理解」题，但当前源数据存在结构性缺损 / script 欠損 / 題尾未回収 / 選択肢未復元 / 要回源音频复核` 等旧文案已从本卷归零。
  - JSON 解析正常。
- 结构备注：
  - 旧 worklog 中的“缺源最小闭环”结论不能视为永久真相；当前 JSON 后续可能重新带回完整 script，届时应及时把旧的保底文案升级为正式证据链终稿。
  - 对 `2.03` 这类概要理解题，只要 question script 仍在且尾部有编号选项，就应优先从当前 script 直接回收选项并重写 explanation，而不是继续保留历史上留下的缺源标签。

### N1_2016_12（回补）

- 文件：data/paper/jlpt/n1/N1_2016_12.json
- 回补背景：本卷 worklog 已记录整卷听力 explanation 通过，但当前 JSON 的 `2.03/2.04/2.05` 再次退回旧式 `options` 退化状态；其中 `2.05 / passage 1` 挂着占位选项和旧 `question 2` 说明条目，`2.05 / passage 2` 则保留了 `1.1冊目` 一类重复编号前缀。本轮按当前文件结构做局部选项层回补与结构纠偏，不重放 explanation 重写。
- 已确认：
  - 听力区 explanation / explanation_expand 仍保持成品状态，范围为 2.01-2.05。
  - `2.03` 当前有 `24` 个占位选项，`2.04` 有 `42` 个占位选项，且两节题级 script 均完整保留编号选项尾部。
  - `2.05 / passage 1` 的提示语是单数 `質問と選択肢を聞いて`，passage script 尾部也只保留了一组问句与四个按摩店选项，因此当前第二个 question object 应判定为 ghost 条目。
  - `2.05 / passage 2` 两题 question / passage script 都不含可直接回收的编号选项，但当前 `options` 正文仍在，只是被污染成 `1.1冊目 / 2.2冊目 / 3.3冊目 / 4.4冊目`。
- 本轮覆盖：
  - 已新增 `fix_n1_2016_12_listening_finalize.py`，仅处理 `2.03/2.04/2.05` 的 `options` 字段与 `2.05 / passage 1` 结构归位。
  - 已从 `2.03` 各题 question script 尾部回收 `1.1 / 2.2 / 3.3 / 4.4` 占位项，恢复为实际题面选项。
  - 已从 `2.04` 各题 question script 尾部回收 `1.1 / 2.2 / 3.3` 占位项，恢复为实际应答句。
  - 已从 `2.05 / passage 1` 的 passage-level script 回收唯一一组按摩店选项：`すっきり / さわやか堂 / 山川クリニック / 太陽`。
  - 已删除 `2.05 / passage 1` 中旧的 ghost `question 2`，使该 passage 回到真实单题结构。
  - 已将 `2.05 / passage 2` 两题的 `1.1冊目` 类畸形前缀清洗为正式 `1冊目 / 2冊目 / 3冊目 / 4冊目` 表述，不改动题目判断链。
- 本轮结果：
  - 2.01 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.02 终检通过：QCOUNT=7 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.03 终检通过：QCOUNT=6 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.04 终检通过：QCOUNT=14 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - 2.05 终检通过：QCOUNT=3 / WARN=0 / PLACEHOLDER_OPTS=0 / ISSUES=0。
  - N1_2016_12 听力整卷终检通过：RANGE=2.01-2.05 / QCOUNT=36 / WARN=0 / PLACEHOLDER_OPTS=0 / HEADING_ISSUES=0。
  - 畸形编号前缀复核通过：`1.1 / 2.2 / 3.3 / 4.4`、`1.1冊目 / 2.2冊目 / 3.3冊目 / 4.4冊目` 均归零。
  - JSON 解析正常。
- 结构备注：
  - 若 `2.05` 的 passage 提示语是单数 `質問と選択肢`，且 script 尾部也只支持一组问句 + 一组选项，应优先按真实 `1+2` 结构记账，不要继续保留旧 ghost question。
  - 若 `2.05` 某题没有可回收的题尾选项，但当前选项正文本身仍有内容，只是带着重复编号前缀，应优先做前缀归一化，不必把该题扩大成“缺源需重建”。

### N3 听力人工收口批次 01

- 范围：
  - `N3_2010_07.json` 听力区 `2.01-2.05`
  - `N3_2011_07.json` 听力区 `2.01-2.05`
  - `N3_2011_12.json` 听力区 `2.01-2.05`
- 范围说明：
  - 按“尽量一次做两年”的节奏先从 N3 最早实际卷起做人工逐题检查。
  - `N3_2010_12.json` 当前为 `sections: []` 的空模板，不计入本批次。
- 本轮人工判断：
  - 三份卷的听力 `explanation / explanation_expand` 主体内容已基本是成品口径，题目判断、证据链、误选项与译文层未发现系统性错位。
  - 批量残留主要集中在 `【实战方法】` 仍是旧的一段式写法，未收成当前统一的三步流程。
  - 个别旧稿还残留轻微缩进和零散句面噪音，本轮一并清理。
- 本轮处理：
  - 对三份卷全部听力题逐题复核现有正文，不改 `correct_answer`。
  - 将 `2.01 課題理解`、`2.02 ポイント理解`、`2.03 概要理解`、`2.04 発話表現`、`2.05 即時応答` 的 `【实战方法】` 统一收为正式三步法。
  - 同步清理旧稿里残留的多余缩进，使听力正文与补充层句面更稳定。
- 本轮结果：
  - `N3_2010_07` 听力区终检通过：`QCOUNT=28` / `RANGE=2.01-2.05`。
  - `N3_2011_07` 听力区终检通过：`QCOUNT=27` / `RANGE=2.01-2.05`。
  - `N3_2011_12` 听力区终检通过：`QCOUNT=27` / `RANGE=2.01-2.05`。
  - 三份卷听力区 `【实战方法】` 均为三步流程。
  - 出版物禁用信号复扫未命中。
  - 三份卷听力区 `correct_answer` 与 `HEAD` 对比保持不变。
  - `git diff --check` 通过。
- 结构备注：
  - 听力区人工检查不能只看机扫命中；本批次已按题干、选项、现有解释与翻译层逐题复核后再决定只收 `【实战方法】`。
  - 对实际已是成品的旧卷，不应为了“有改动”而重写正文；只把不达当前统一口径的部分收平即可。

### N3 听力人工收口批次 02

- 范围：
  - `N3_2012_07.json` 听力区 `2.01-2.05`
  - `N3_2012_12.json` 听力区 `2.01-2.05`
  - `N3_2013_07.json` 听力区 `2.01-2.05`
  - `N3_2013_12.json` 听力区 `2.01-2.05`
- 收口定位：
  - 继续按两年一批做 N3 听力人工逐题检查，不以抽检代替验收。
  - `2012` 两份卷的主体问题仍是 `【实战方法】` 保留旧的一段式写法。
  - `2013` 两份卷除方法段外，还存在反引号与“答案是”式收束等出版物残留。
- 本轮人工判断：
  - 四份卷听力 `explanation / explanation_expand` 主体证据链整体可用，未发现成片的答案错位或误选项张冠李戴。
  - `N3_2012_07/12` 的正文主要是句面口吻仍偏旧稿，方法段未收成三步。
  - `N3_2013_07/12` 的正文存在日语引文仍用反引号、个别句子残留“答案是”式流程话术，需要清到正式成稿口吻。
- 本轮处理：
  - 对四份卷全部听力题逐题复核现有正文，不改 `correct_answer`。
  - 将 `2.01 課題理解`、`2.02 ポイント理解`、`2.03 概要理解`、`2.04 発話表現`、`2.05 即時応答` 的 `【实战方法】` 统一收为正式三步法。
  - 将 `N3_2013_07/12` 中正文和补充层的反引号统一改为正式引文写法。
  - 将 `N3_2013_07/12` 中“答案是”式句面改写为出版物口吻。
  - 顺手清理少量旧稿式口语尾句，使句面更稳。
- 本轮结果：
  - `N3_2012_07` 听力区终检通过：`QCOUNT=28` / `RANGE=2.01-2.05`。
  - `N3_2012_12` 听力区终检通过：`QCOUNT=28` / `RANGE=2.01-2.05`。
  - `N3_2013_07` 听力区终检通过：`QCOUNT=28` / `RANGE=2.01-2.05`。
  - `N3_2013_12` 听力区终检通过：`QCOUNT=28` / `RANGE=2.01-2.05`。
  - 四份卷听力区 `【实战方法】` 均为三步流程。
  - 反引号与“答案是”残留复扫归零。
  - 四份卷听力区 `correct_answer` 与 `HEAD` 对比保持不变。
  - `git diff --check` 通过，仅保留既有 LF/CRLF 提示。
- 结构备注：
  - 听力旧稿里常见的反引号与“答案是”并不一定意味着整题重写；若判断链条仍成立，应优先做成品化清理，而不是无差别重写。
  - 对已经成型的听力正文，人工检查重点仍应先放在判断链、误选项和信息流，再处理三步法与句面统一。

### N3 听力人工收口批次 03

- 范围：
  - `N3_2014_07.json` 听力区 `2.01-2.05`
  - `N3_2014_12.json` 听力区 `2.01-2.05`
  - `N3_2015_07.json` 听力区 `2.01-2.05`
  - `N3_2015_12.json` 听力区 `2.01-2.05`
- 收口定位：
  - 继续按两年一批做 N3 听力人工逐题检查。
  - 本批四份卷的残留形态高度一致：全部听力题的 `【实战方法】` 仍是一段式旧口径，正文同时系统性残留反引号与“答案是”式流程话术。
  - `N3_2015_12` 另有一题命中“模板”残留，一并在本批清除。
- 本轮人工判断：
  - 四份卷听力 `explanation / explanation_expand` 主体判断链整体可用，未发现成片的答案错位。
  - 主要问题集中在出版物口吻未收平，而不是题目判断方向错误。
  - 个别句子虽逻辑正确，但仍保留旧稿式“答案是”“就对了”之类收束，本轮统一改为正式成稿语气。
- 本轮处理：
  - 对四份卷全部听力题逐题复核现有正文，不改 `correct_answer`。
  - 将 `2.01 課題理解`、`2.02 ポイント理解`、`2.03 概要理解`、`2.04 発話表現`、`2.05 即時応答` 的 `【实战方法】` 统一收为正式三步法。
  - 将四份卷正文和补充层中的反引号统一改为正式引文写法。
  - 将四份卷中的“答案是”式句面改写为正式出版物口吻。
  - 清理 `N3_2015_12` 听力区的“模板”词面残留。
- 本轮结果：
  - `N3_2014_07` 听力区终检通过：`QCOUNT=28` / `RANGE=2.01-2.05`。
  - `N3_2014_12` 听力区终检通过：`QCOUNT=28` / `RANGE=2.01-2.05`。
  - `N3_2015_07` 听力区终检通过：`QCOUNT=28` / `RANGE=2.01-2.05`。
  - `N3_2015_12` 听力区终检通过：`QCOUNT=28` / `RANGE=2.01-2.05`。
  - 四份卷听力区 `【实战方法】` 均为三步流程。
  - 反引号、“答案是”、`模板` 残留复扫归零。
  - 四份卷听力区 `correct_answer` 与 `HEAD` 对比保持不变。
  - `git diff --check` 通过，仅保留既有 LF/CRLF 提示。
- 结构备注：
  - 对这类“整体判断链已可用、但口吻仍停在旧稿”的听力卷，人工逐题检查后的合理处理是成品化收平，而不是无差别重写全文。
  - 即时应答与发话表达题尤其容易残留旧式“答案是”收束，本批已统一改成面向读者的正式表述。

### N3 听力人工收口批次 04

- 范围：
  - `N3_2016_07.json` 听力区 `2.01-2.05`
  - `N3_2016_12.json` 听力区 `2.01-2.05`
  - `N3_2017_07.json` 听力区 `2.01-2.05`
  - `N3_2017_12.json` 听力区 `2.01-2.05`
- 收口定位：
  - 继续按两年一批做 N3 听力人工逐题检查。
  - 这四份卷的共性问题仍是 `【实战方法】` 保留一段式旧写法，未收成当前三步流程。
  - 其中 `N3_2016_07` 还系统性残留反引号与“答案是”式收束，本批一并清理。
- 本轮人工判断：
  - 四份卷听力 `explanation / explanation_expand` 主体判断链整体可用，未发现成片的答案错位或误选项张冠李戴。
  - `N3_2016_12 / 2017_07 / 2017_12` 的主要问题集中在方法段旧口径，正文主体已接近成稿。
  - `N3_2016_07` 的正文存在较多旧式“答案是”收束与反引号引文，需先清成正式出版物口吻，再统一方法段。
- 本轮处理：
  - 对四份卷全部听力题逐题复核现有正文，不改 `correct_answer`。
  - 将 `2.01 課題理解`、`2.02 ポイント理解`、`2.03 概要理解`、`2.04 発話表現`、`2.05 即時応答` 的 `【实战方法】` 统一收为正式三步法。
  - 将 `N3_2016_07` 听力区正文和补充层中的反引号统一改为正式引文写法。
  - 将 `N3_2016_07` 听力区中的“答案是”式句面改写为正式出版物口吻。
- 本轮结果：
  - `N3_2016_07` 听力区终检通过：`QCOUNT=28` / `RANGE=2.01-2.05`。
  - `N3_2016_12` 听力区终检通过：`QCOUNT=28` / `RANGE=2.01-2.05`。
  - `N3_2017_07` 听力区终检通过：`QCOUNT=28` / `RANGE=2.01-2.05`。
  - `N3_2017_12` 听力区终检通过：`QCOUNT=28` / `RANGE=2.01-2.05`。
  - 四份卷听力区 `【实战方法】` 均为三步流程。
  - `N3_2016_07` 的反引号与“答案是”残留复扫归零；四份卷禁用信号复扫均未命中。
  - 四份卷听力区 `correct_answer` 与 `HEAD` 对比保持不变。
  - `git diff --check` 通过。
- 结构备注：
  - 这批四份卷仍属于“主体判断链可用，但方法段与句面不完全符合当前标准”的旧稿，不必为了收口而整题重写。
  - 对 `N3_2016_07` 这类正文已基本可用、但残留集中在流程话术和引文标记的卷，优先做成品化清理，再统一三步法，性价比最高。

### N3 听力人工收口批次 05

- 范围：
  - `N3_2018_07.json` 听力区 `2.01-2.05`
  - `N3_2018_12.json` 听力区 `2.01-2.05`
  - `N3_2019_07.json` 听力区 `2.01-2.05`
  - `N3_2019_12.json` 听力区 `2.01-2.05`
- 收口定位：
  - 继续按两年一批做 N3 听力人工逐题检查。
  - 这批四份卷的主要问题都集中在 `【实战方法】` 仍保留旧的一段式写法，未收成当前统一三步流程。
  - `N3_2019_12` 中个别方法段虽已拆成多句，但仍未按编号三步落地，本批一并收平。
- 本轮人工判断：
  - 四份卷听力 `explanation / explanation_expand` 主体判断链整体可用，未发现系统性的答案错位、证据落点偏移或误选项张冠李戴。
  - `2018-2019` 这四份卷的正文主体已经接近成稿，主要缺口是方法段口径未统一，而不是正文判断逻辑错误。
  - 因此本轮按逐题复核后的结论，只收方法段，不无差别重写正文。
- 本轮处理：
  - 对四份卷全部听力题逐题复核现有正文，不改 `correct_answer`。
  - 将 `2.01 課題理解`、`2.02 ポイント理解`、`2.03 概要理解`、`2.04 発話表現`、`2.05 即時応答` 的 `【实战方法】` 统一收为正式三步法。
  - 对 `N3_2019_12` 中个别已拆行为多句、但未按编号三步落地的方法段，同步改成标准编号格式。
- 本轮结果：
  - `N3_2018_07` 听力区终检通过：`QCOUNT=28` / `RANGE=2.01-2.05`。
  - `N3_2018_12` 听力区终检通过：`QCOUNT=28` / `RANGE=2.01-2.05`。
  - `N3_2019_07` 听力区终检通过：`QCOUNT=28` / `RANGE=2.01-2.05`。
  - `N3_2019_12` 听力区终检通过：`QCOUNT=28` / `RANGE=2.01-2.05`。
  - 四份卷听力区 `【实战方法】` 均为三步流程。
  - 四份卷禁用信号复扫未命中。
  - 四份卷听力区 `correct_answer` 与 `HEAD` 对比保持不变。
  - `git diff --check` 通过。
- 结构备注：
  - 当整批卷面主体已经接近成稿时，人工逐题检查后的合理动作应是只收仍未达标的结构件，而不是为了“看起来改得多”去重写本来可用的正文。
  - `N3_2019_12` 说明旧稿并不一定只是一整段；即使方法段已经拆成多句，只要还没落到标准编号三步，也仍然要按当前统一口径收平。

### N3 听力人工收口批次 06

- 范围：
  - `N3_2020_12.json` 听力区 `2.01-2.05`
  - `N3_2021_07.json` 听力区 `2.01-2.05`
  - `N3_2021_12.json` 听力区 `2.01-2.05`
- 范围说明：
  - 本轮原计划顺推 `N3_2020_07 / N3_2020_12 / N3_2021_07 / N3_2021_12`。
  - 其中 `N3_2020_07.json` 当前为 `exam_info.sections = []` 的空模板，不计入本批实际收口范围。
- 收口定位：
  - 继续按两年一批做 N3 听力人工逐题检查，不以抽检代替验收。
  - 三份实际卷的主要问题都集中在 `【实战方法】` 仍保留旧的一段式或非编号写法，未收成当前统一三步流程。
  - `N3_2021_12` 个别方法段已经拆成多句，但仍不是标准编号三步，本批一并收平。
- 本轮人工判断：
  - 三份卷听力 `explanation / explanation_expand` 主体判断链整体可用，未发现系统性的答案错位、证据落点偏移或误选项张冠李戴。
  - `2020_12-2021_12` 这三份卷的正文主体已接近成稿，主要缺口是方法段口径未统一，而不是正文判断逻辑错误。
  - 因此本轮按逐题复核后的结论，只收方法段，不无差别重写正文。
- 本轮处理：
  - 对三份卷全部听力题逐题复核现有正文，不改 `correct_answer`。
  - 将 `2.01 課題理解`、`2.02 ポイント理解`、`2.03 概要理解`、`2.04 発話表現`、`2.05 即時応答` 的 `【实战方法】` 统一收为正式三步法。
  - 对 `N3_2021_12` 中个别已拆行为多句、但未按编号三步落地的方法段，同步改成标准编号格式。
- 本轮结果：
  - `N3_2020_12` 听力区终检通过：`QCOUNT=28` / `RANGE=2.01-2.05`。
  - `N3_2021_07` 听力区终检通过：`QCOUNT=28` / `RANGE=2.01-2.05`。
  - `N3_2021_12` 听力区终检通过：`QCOUNT=28` / `RANGE=2.01-2.05`。
  - 三份卷听力区 `【实战方法】` 均为三步流程。
  - 三份卷禁用信号复扫未命中。
  - 三份卷听力区 `correct_answer` 与 `HEAD` 对比保持不变。
  - `git diff --check` 通过。
- 结构备注：
  - `N3_2020_07` 当前为空模板，不能把它和三份实际卷混记成“四份卷已完成”；范围记账仍以当前文件实物为准。
  - 当整批卷面主体已经接近成稿时，人工逐题检查后的合理动作仍是只收仍未达标的结构件，而不是重写本来可用的正文。

### N3 听力人工收口批次 07

- 范围：
  - `N3_2022_07.json` 听力区 `2.01-2.05`
  - `N3_2022_12.json` 听力区 `2.01-2.05`
  - `N3_2023_07.json` 听力区 `2.01-2.05`
  - `N3_2023_12.json` 听力区 `2.01-2.05`
- 收口定位：
  - 继续按两年一批做 N3 听力人工逐题检查，不以抽检代替验收。
  - 四份卷的主要问题都集中在 `【实战方法】` 仍保留旧的一段式或非编号写法，未收成当前统一三步流程。
  - `N3_2022_07 / N3_2023_12` 中个别方法段还带额外补充句，但仍不是标准编号三步，本批一并收平。
- 本轮人工判断：
  - 四份卷听力 `explanation / explanation_expand` 主体判断链整体可用，未发现系统性的答案错位、证据落点偏移或误选项张冠李戴。
  - `2022_07-2023_12` 这四份卷的正文主体已接近成稿，主要缺口是方法段口径未统一，而不是正文判断逻辑错误。
  - 因此本轮按逐题复核后的结论，只收方法段，不无差别重写正文。
- 本轮处理：
  - 对四份卷全部听力题逐题复核现有正文，不改 `correct_answer`。
  - 将 `2.01 課題理解`、`2.02 ポイント理解`、`2.03 概要理解`、`2.04 発話表現`、`2.05 即時応答` 的 `【实战方法】` 统一收为正式三步法。
  - 对 `N3_2022_07 / N3_2023_12` 中个别已拆行为多句、但未按编号三步落地的方法段，同步改成标准编号格式。
- 本轮结果：
  - `N3_2022_07` 听力区终检通过：`QCOUNT=28` / `RANGE=2.01-2.05`。
  - `N3_2022_12` 听力区终检通过：`QCOUNT=28` / `RANGE=2.01-2.05`。
  - `N3_2023_07` 听力区终检通过：`QCOUNT=28` / `RANGE=2.01-2.05`。
  - `N3_2023_12` 听力区终检通过：`QCOUNT=28` / `RANGE=2.01-2.05`。
  - 四份卷听力区 `【实战方法】` 均为三步流程。
  - 四份卷禁用信号复扫未命中。
  - 四份卷听力区 `correct_answer` 与 `HEAD` 对比保持不变。
  - `git diff --check` 通过。
- 结构备注：
  - 当整批卷面主体已经接近成稿时，人工逐题检查后的合理动作仍是只收仍未达标的结构件，而不是重写本来可用的正文。
  - 即使旧方法段已经拆成两三句，只要还没落到标准编号三步，也仍然要按当前统一口径收平。

### N3 听力人工收口批次 08

- 范围：
  - `N3_2024_07.json` 听力区 `2.01-2.05`
  - `N3_2024_12.json` 听力区 `2.01-2.05`
- 范围说明：
  - 本轮原计划顺推 `N3_2024_07 / N3_2024_12 / N3_2025_07 / N3_2025_12`。
  - 其中 `N3_2025_07.json` 与 `N3_2025_12.json` 当前均为 `exam_info.sections = []` 的空模板，不计入本批实际收口范围。
- 收口定位：
  - 继续按两年一批做 N3 听力人工逐题检查，不以抽检代替验收。
  - 两份实际卷的主要问题都集中在 `【实战方法】` 仍保留旧的一段式或非编号写法，未收成当前统一三步流程。
  - `N3_2024_07 / N3_2024_12` 的正文主体已接近成稿，本轮不无差别重写正文。
- 本轮人工判断：
  - 两份卷听力 `explanation / explanation_expand` 主体判断链整体可用，未发现系统性的答案错位、证据落点偏移或误选项张冠李戴。
  - 因此本轮按逐题复核后的结论，只收方法段，不改 `correct_answer`，也不重写可用正文。
- 本轮处理：
  - 对两份卷全部听力题逐题复核现有正文，不改 `correct_answer`。
  - 将 `2.01 課題理解`、`2.02 ポイント理解`、`2.03 概要理解`、`2.04 発話表現`、`2.05 即時応答` 的 `【实战方法】` 统一收为正式三步法。
- 本轮结果：
  - `N3_2024_07` 听力区终检通过：`QCOUNT=28` / `RANGE=2.01-2.05`。
  - `N3_2024_12` 听力区终检通过：`QCOUNT=28` / `RANGE=2.01-2.05`。
  - 两份卷听力区 `【实战方法】` 均为三步流程。
  - 两份卷禁用信号复扫未命中。
  - 两份卷听力区 `correct_answer` 与 `HEAD` 对比保持不变。
  - `git diff --check` 通过。
- 结构备注：
  - `N3_2025_07 / N3_2025_12` 当前为空模板，不能与 `2024` 两份实际卷混记成“四份卷已完成”；范围记账仍以当前文件实物为准。
  - 当整批卷面主体已经接近成稿时，人工逐题检查后的合理动作仍是只收仍未达标的结构件，而不是重写本来可用的正文。

### N2 听力人工收口批次 01

- 范围：
  - `N2_2010_07.json` 听力区 `2.01-2.05`
  - `N2_2010_12.json` 听力区 `2.01-2.05`
  - `N2_2011_07.json` 听力区 `2.01-2.05`
  - `N2_2011_12.json` 听力区 `2.01-2.05`
- 收口定位：
  - N3 实际卷顺推到头后，切到 N2 听力最早一批，继续按两年一批做人工逐题检查。
  - 本批四份卷中，`N2_2010_12` 起手已符合当前听力口径，机械复扫 `HITS=0`。
  - 其余三份卷的主要问题集中在 `【实战方法】` 仍保留旧的一段式写法，未收成当前统一三步流程。
- 本轮人工判断：
  - 四份卷听力 `explanation / explanation_expand` 主体判断链整体可用，未发现系统性的答案错位、证据落点偏移或误选项张冠李戴。
  - `N2_2010_07 / N2_2011_07 / N2_2011_12` 的正文主体已接近成稿，主要缺口是方法段口径未统一，而不是正文判断逻辑错误。
  - 因此本轮按逐题复核后的结论，只收方法段，不无差别重写正文。
- 本轮处理：
  - 对四份卷全部听力题逐题复核现有正文，不改 `correct_answer`。
  - 将 `N2_2010_07 / N2_2011_07 / N2_2011_12` 的 `2.01 課題理解`、`2.02 ポイント理解`、`2.03 概要理解`、`2.04 発話表現`、`2.05 即時応答` 的 `【实战方法】` 统一收为正式三步法。
  - `N2_2010_12` 起手已过线，本轮只纳入批次复核与总体验收，不做正文改动。
- 本轮结果：
  - `N2_2010_07` 听力区终检通过：`QCOUNT=32` / `RANGE=2.01-2.05`。
  - `N2_2010_12` 听力区终检通过：`QCOUNT=32` / `RANGE=2.01-2.05`。
  - `N2_2011_07` 听力区终检通过：`QCOUNT=31` / `RANGE=2.01-2.05`。
  - `N2_2011_12` 听力区终检通过：`QCOUNT=31` / `RANGE=2.01-2.05`。
  - 四份卷听力区 `【实战方法】` 均为三步流程。
  - 四份卷禁用信号复扫未命中。
  - 四份卷听力区 `correct_answer` 与 `HEAD` 对比保持不变。
  - `git diff --check` 通过。
- 结构备注：
  - 整批验收可以包含“起手已过线”的卷，但日志必须写清哪些卷实际有改动，哪些卷只是复核后确认继续通过。
  - 当整批卷面主体已经接近成稿时，人工逐题检查后的合理动作仍是只收仍未达标的结构件，而不是重写本来可用的正文。

### N2 听力人工收口批次 02

- 范围：
  - `N2_2012_07.json` 听力区 `2.01-2.05`
  - `N2_2012_12.json` 听力区 `2.01-2.05`
  - `N2_2013_07.json` 听力区 `2.01-2.05`
  - `N2_2013_12.json` 听力区 `2.01-2.05`
- 收口定位：
  - 继续按两年一批做 N2 听力人工逐题检查。
  - 本批四份卷的主要问题都集中在 `【实战方法】` 仍保留旧的一段式写法，未收成当前统一三步流程。
  - 四份卷正文主体已接近成稿，本轮不无差别重写正文。
- 本轮人工判断：
  - 四份卷听力 `explanation / explanation_expand` 主体判断链整体可用，未发现系统性的答案错位、证据落点偏移或误选项张冠李戴。
  - `2012-2013` 这四份卷的主要缺口是方法段口径未统一，而不是正文判断逻辑错误。
  - 因此本轮按逐题复核后的结论，只收方法段，不改 `correct_answer`，也不重写可用正文。
- 本轮处理：
  - 对四份卷全部听力题逐题复核现有正文，不改 `correct_answer`。
  - 将 `2.01 課題理解`、`2.02 ポイント理解`、`2.03 概要理解`、`2.04 発話表現`、`2.05 即時応答` 的 `【实战方法】` 统一收为正式三步法。
- 本轮结果：
  - `N2_2012_07` 听力区终检通过：`QCOUNT=31` / `RANGE=2.01-2.05`。
  - `N2_2012_12` 听力区终检通过：`QCOUNT=31` / `RANGE=2.01-2.05`。
  - `N2_2013_07` 听力区终检通过：`QCOUNT=31` / `RANGE=2.01-2.05`。
  - `N2_2013_12` 听力区终检通过：`QCOUNT=32` / `RANGE=2.01-2.05`。
  - 四份卷听力区 `【实战方法】` 均为三步流程。
  - 四份卷禁用信号复扫未命中。
  - 四份卷听力区 `correct_answer` 与 `HEAD` 对比保持不变。
  - `git diff --check` 通过。
- 结构备注：
  - 当整批卷面主体已经接近成稿时，人工逐题检查后的合理动作仍是只收仍未达标的结构件，而不是重写本来可用的正文。
  - 本批四份卷题量并不完全一致，记账时仍按当前文件实物的 `QCOUNT=31 / 31 / 31 / 32` 分别记录，不做机械并齐。

### N2 听力人工收口批次 03

- 范围：
  - `N2_2014_07.json` 听力区 `2.01-2.05`
  - `N2_2014_12.json` 听力区 `2.01-2.05`
  - `N2_2015_07.json` 听力区 `2.01-2.05`
  - `N2_2015_12.json` 听力区 `2.01-2.05`
- 收口定位：
  - 继续按两年一批做 N2 听力人工逐题检查。
  - 本批四份卷的主要问题都集中在 `【实战方法】` 仍保留旧的一段式写法，未收成当前统一三步流程。
  - 四份卷正文主体已接近成稿，本轮不无差别重写正文。
- 本轮人工判断：
  - 四份卷听力 `explanation / explanation_expand` 主体判断链整体可用，未发现系统性的答案错位、证据落点偏移或误选项张冠李戴。
  - `2014-2015` 这四份卷的主要缺口是方法段口径未统一，而不是正文判断逻辑错误。
  - 因此本轮按逐题复核后的结论，只收方法段，不改 `correct_answer`，也不重写可用正文。
- 本轮处理：
  - 对四份卷全部听力题逐题复核现有正文，不改 `correct_answer`。
  - 将 `2.01 課題理解`、`2.02 ポイント理解`、`2.03 概要理解`、`2.04 発話表現`、`2.05 即時応答` 的 `【实战方法】` 统一收为正式三步法。
- 本轮结果：
  - `N2_2014_07` 听力区终检通过：`QCOUNT=32` / `RANGE=2.01-2.05`。
  - `N2_2014_12` 听力区终检通过：`QCOUNT=32` / `RANGE=2.01-2.05`。
  - `N2_2015_07` 听力区终检通过：`QCOUNT=32` / `RANGE=2.01-2.05`。
  - `N2_2015_12` 听力区终检通过：`QCOUNT=32` / `RANGE=2.01-2.05`。
  - 四份卷听力区 `【实战方法】` 均为三步流程。
  - 四份卷禁用信号复扫未命中。
  - 四份卷听力区 `correct_answer` 与 `HEAD` 对比保持不变。
  - `git diff --check` 通过。
- 结构备注：
  - 当整批卷面主体已经接近成稿时，人工逐题检查后的合理动作仍是只收仍未达标的结构件，而不是重写本来可用的正文。
  - 本批四份卷题量一致为 `QCOUNT=32`，但仍应按卷分别记账，不把整批通过简化成“自动视作同质完成”。

### N2 听力人工收口批次 04

- 范围：
  - `N2_2016_07.json` 听力区 `2.01-2.05`
  - `N2_2016_12.json` 听力区 `2.01-2.05`
  - `N2_2017_07.json` 听力区 `2.01-2.05`
  - `N2_2017_12.json` 听力区 `2.01-2.05`
- 收口定位：
  - 继续按两年一批做 N2 听力人工逐题检查。
  - 本批四份卷的主要问题都集中在 `【实战方法】` 仍保留旧的一段式或非标准写法，未收成当前统一三步流程。
  - 其中 `N2_2017_07 / N2_2017_12` 的旧稿还存在把 `【关键表达】` 串进 `【实战方法】` 区块的情况，本轮一并收平。
- 本轮人工判断：
  - 四份卷听力 `explanation / explanation_expand` 主体判断链整体可用，未发现系统性的答案错位、证据落点偏移或误选项张冠李戴。
  - `2016-2017` 这四份卷的主要缺口是方法段口径未统一，而不是正文判断逻辑错误。
  - 因此本轮按逐题复核后的结论，只收方法段，不改 `correct_answer`，也不重写可用正文。
- 本轮处理：
  - 对四份卷全部听力题逐题复核现有正文，不改 `correct_answer`。
  - 将 `2.01 課題理解`、`2.02 ポイント理解`、`2.03 概要理解`、`2.04 発話表現`、`2.05 即時応答` 的 `【实战方法】` 统一收为正式三步法。
  - 对 `N2_2017_07 / N2_2017_12` 中旧稿把 `【关键表达】` 串进 `【实战方法】` 的异常块，按标题边界重新切块，恢复为标准 `【实战方法】 + 【关键表达】` 层级。
- 本轮结果：
  - `N2_2016_07` 听力区终检通过：`QCOUNT=32` / `RANGE=2.01-2.05`。
  - `N2_2016_12` 听力区终检通过：`QCOUNT=32` / `RANGE=2.01-2.05`。
  - `N2_2017_07` 听力区终检通过：`QCOUNT=32` / `RANGE=2.01-2.05`。
  - `N2_2017_12` 听力区终检通过：`QCOUNT=32` / `RANGE=2.01-2.05`。
  - 四份卷听力区 `【实战方法】` 均为三步流程。
  - 四份卷禁用信号复扫未命中。
  - 四份卷听力区 `correct_answer` 与 `HEAD` 对比保持不变。
  - `git diff --check` 通过。
- 结构备注：
  - 当旧稿把下一个标题误并进 `【实战方法】` 时，不能只做表面句面替换，必须按标题边界恢复层级结构，再谈三步法收口。
  - 当整批卷面主体已经接近成稿时，人工逐题检查后的合理动作仍是只收仍未达标的结构件，而不是重写本来可用的正文。

### N2 听力人工收口批次 05

- 范围：
  - `N2_2018_07.json` 听力区 `2.01-2.05`
  - `N2_2018_12.json` 听力区 `2.01-2.05`
  - `N2_2019_07.json` 听力区 `2.01-2.05`
  - `N2_2019_12.json` 听力区 `2.01-2.05`
- 收口定位：
  - 继续按两年一批做 N2 听力人工逐题检查。
  - 本批四份卷的主要问题都集中在 `【实战方法】` 仍保留旧的一段式或非标准写法，未收成当前统一三步流程。
  - 四份卷旧稿都存在把 `【关键表达】` 串进 `【实战方法】` 区块的情况，本轮一并收平。
- 本轮人工判断：
  - 四份卷听力 `explanation / explanation_expand` 主体判断链整体可用，未发现系统性的答案错位、证据落点偏移或误选项张冠李戴。
  - `2018-2019` 这四份卷的主要缺口是方法段口径未统一，而不是正文判断逻辑错误。
  - 因此本轮按逐题复核后的结论，只收方法段，不改 `correct_answer`，也不重写可用正文。
- 本轮处理：
  - 对四份卷全部听力题逐题复核现有正文，不改 `correct_answer`。
  - 将 `2.01 課題理解`、`2.02 ポイント理解`、`2.03 概要理解`、`2.04 発話表現`、`2.05 即時応答` 的 `【实战方法】` 统一收为正式三步法。
  - 对四份卷中旧稿把 `【关键表达】` 串进 `【实战方法】` 的异常块，按标题边界重新切块，恢复为标准 `【实战方法】 + 【关键表达】` 层级。
- 本轮结果：
  - `N2_2018_07` 听力区终检通过：`QCOUNT=30` / `RANGE=2.01-2.05`。
  - `N2_2018_12` 听力区终检通过：`QCOUNT=30` / `RANGE=2.01-2.05`。
  - `N2_2019_07` 听力区终检通过：`QCOUNT=30` / `RANGE=2.01-2.05`。
  - `N2_2019_12` 听力区终检通过：`QCOUNT=30` / `RANGE=2.01-2.05`。
  - 四份卷听力区 `【实战方法】` 均为三步流程。
  - 四份卷禁用信号复扫未命中。
  - 四份卷听力区 `correct_answer` 与 `HEAD` 对比保持不变。
  - `git diff --check` 通过。
- 结构备注：
  - 当旧稿把下一个标题误并进 `【实战方法】` 时，不能只做表面句面替换，必须按标题边界恢复层级结构，再谈三步法收口。
  - 本批四份卷题量一致为 `QCOUNT=30`，但仍应按卷分别记账，不把整批通过简化成“自动视作同质完成”。

### N2 听力人工收口批次 06

- 范围：
  - `N2_2020_12.json` 听力区 `2.01-2.05`
  - `N2_2021_07.json` 听力区 `2.01-2.05`
  - `N2_2021_12.json` 听力区 `2.01-2.05`
- 范围说明：
  - 本轮原计划顺推 `N2_2020_07 / N2_2020_12 / N2_2021_07 / N2_2021_12`。
  - 其中 `N2_2020_07.json` 当前为 `exam_info.sections = []` 的空模板，不计入本批实际收口范围。
- 收口定位：
  - 继续按两年一批做 N2 听力人工逐题检查。
  - 三份实际卷的主要问题都集中在 `【实战方法】` 仍保留旧的一段式或非标准写法，未收成当前统一三步流程。
  - 三份卷旧稿都存在把 `【关键表达】` 串进 `【实战方法】` 区块的情况，本轮一并收平。
- 本轮人工判断：
  - 三份卷听力 `explanation / explanation_expand` 主体判断链整体可用，未发现系统性的答案错位、证据落点偏移或误选项张冠李戴。
  - `2020_12-2021_12` 这三份卷的主要缺口是方法段口径未统一，而不是正文判断逻辑错误。
  - 因此本轮按逐题复核后的结论，只收方法段，不改 `correct_answer`，也不重写可用正文。
- 本轮处理：
  - 对三份卷全部听力题逐题复核现有正文，不改 `correct_answer`。
  - 将 `2.01 課題理解`、`2.02 ポイント理解`、`2.03 概要理解`、`2.04 発話表現`、`2.05 即時応答` 的 `【实战方法】` 统一收为正式三步法。
  - 对三份卷中旧稿把 `【关键表达】` 串进 `【实战方法】` 的异常块，按标题边界重新切块，恢复为标准 `【实战方法】 + 【关键表达】` 层级。
- 本轮结果：
  - `N2_2020_12` 听力区终检通过：`QCOUNT=30` / `RANGE=2.01-2.05`。
  - `N2_2021_07` 听力区终检通过：`QCOUNT=30` / `RANGE=2.01-2.05`。
  - `N2_2021_12` 听力区终检通过：`QCOUNT=30` / `RANGE=2.01-2.05`。
  - 三份卷听力区 `【实战方法】` 均为三步流程。
  - 三份卷禁用信号复扫未命中。
  - 三份卷听力区 `correct_answer` 与 `HEAD` 对比保持不变。
  - `git diff --check` 通过。
- 结构备注：
  - `N2_2020_07` 当前为空模板，不能把它和三份实际卷混记成“四份卷已完成”；范围记账仍以当前文件实物为准。
  - 当旧稿把下一个标题误并进 `【实战方法】` 时，不能只做表面句面替换，必须按标题边界恢复层级结构，再谈三步法收口。

### N2 听力人工收口批次 07

- 范围：
  - `N2_2022_07.json` 听力区 `2.01-2.05`
  - `N2_2022_12.json` 听力区 `2.01-2.05`
  - `N2_2023_07.json` 听力区 `2.01-2.05`
  - `N2_2023_12.json` 听力区 `2.01-2.05`
- 收口定位：
  - 继续按两年一批做 N2 听力人工逐题检查。
  - 四份卷的主要问题都集中在 `【实战方法】` 仍保留旧的一段式或非标准写法，未收成当前统一三步流程。
  - 四份卷旧稿都存在把 `【关键表达】` 串进 `【实战方法】` 区块的情况，本轮一并收平。
- 本轮人工判断：
  - 四份卷听力 `explanation / explanation_expand` 主体判断链整体可用，未发现系统性的答案错位、证据落点偏移或误选项张冠李戴。
  - `2022-2023` 这四份卷的主要缺口是方法段口径未统一，而不是正文判断逻辑错误。
  - 因此本轮按逐题复核后的结论，只收方法段，不改 `correct_answer`，也不重写可用正文。
- 本轮处理：
  - 对四份卷全部听力题逐题复核现有正文，不改 `correct_answer`。
  - 将 `2.01 課題理解`、`2.02 ポイント理解`、`2.03 概要理解`、`2.04 発話表現`、`2.05 即時応答` 的 `【实战方法】` 统一收为正式三步法。
  - 对四份卷中旧稿把 `【关键表达】` 串进 `【实战方法】` 的异常块，按标题边界重新切块，恢复为标准 `【实战方法】 + 【关键表达】` 层级。
- 本轮结果：
  - `N2_2022_07` 听力区终检通过：`QCOUNT=30` / `RANGE=2.01-2.05`。
  - `N2_2022_12` 听力区终检通过：`QCOUNT=30` / `RANGE=2.01-2.05`。
  - `N2_2023_07` 听力区终检通过：`QCOUNT=30` / `RANGE=2.01-2.05`。
  - `N2_2023_12` 听力区终检通过：`QCOUNT=30` / `RANGE=2.01-2.05`。
  - 四份卷听力区 `【实战方法】` 均为三步流程。
  - 四份卷禁用信号复扫未命中。
  - 四份卷听力区 `correct_answer` 与 `HEAD` 对比保持不变。
  - `git diff --check` 通过。
- 结构备注：
  - 当旧稿把下一个标题误并进 `【实战方法】` 时，不能只做表面句面替换，必须按标题边界恢复层级结构，再谈三步法收口。
  - 本批四份卷题量一致为 `QCOUNT=30`，但仍应按卷分别记账，不把整批通过简化成“自动视作同质完成”。

### N2 听力人工收口批次 08

- 范围：
  - `N2_2024_07.json` 听力区 `2.01-2.05`
  - `N2_2024_12.json` 听力区 `2.01-2.05`
  - `N2_2025_07.json` 听力区 `2.01-2.05`
- 范围说明：
  - 本轮原计划顺推 `N2_2024_07 / N2_2024_12 / N2_2025_07 / N2_2025_12`。
  - 其中 `N2_2025_12.json` 当前为 `exam_info.sections = []` 的空模板，不计入本批实际收口范围。
- 收口定位：
  - 继续按两年一批做 N2 听力人工逐题检查。
  - 三份实际卷的主要问题都集中在 `【实战方法】` 仍保留旧的一段式或非标准写法，未收成当前统一三步流程。
  - 三份卷旧稿都存在把 `【关键表达】` 串进 `【实战方法】` 区块的情况，本轮一并收平。
- 本轮人工判断：
  - 三份卷听力 `explanation / explanation_expand` 主体判断链整体可用，未发现系统性的答案错位、证据落点偏移或误选项张冠李戴。
  - `2024_07-2025_07` 这三份卷的主要缺口是方法段口径未统一，而不是正文判断逻辑错误。
  - 因此本轮按逐题复核后的结论，只收方法段，不改 `correct_answer`，也不重写可用正文。
- 本轮处理：
  - 对三份卷全部听力题逐题复核现有正文，不改 `correct_answer`。
  - 将 `2.01 課題理解`、`2.02 ポイント理解`、`2.03 概要理解`、`2.04 発話表現`、`2.05 即時応答` 的 `【实战方法】` 统一收为正式三步法。
  - 对三份卷中旧稿把 `【关键表达】` 串进 `【实战方法】` 的异常块，按标题边界重新切块，恢复为标准 `【实战方法】 + 【关键表达】` 层级。
- 本轮结果：
  - `N2_2024_07` 听力区终检通过：`QCOUNT=30` / `RANGE=2.01-2.05`。
  - `N2_2024_12` 听力区终检通过：`QCOUNT=30` / `RANGE=2.01-2.05`。
  - `N2_2025_07` 听力区终检通过：`QCOUNT=30` / `RANGE=2.01-2.05`。
  - 三份卷听力区 `【实战方法】` 均为三步流程。
  - 三份卷禁用信号复扫未命中。
  - 三份卷听力区 `correct_answer` 与 `HEAD` 对比保持不变。
  - `git diff --check` 通过。
- 结构备注：
  - `N2_2025_12` 当前为空模板，不能把它和三份实际卷混记成“四份卷已完成”；范围记账仍以当前文件实物为准。
  - 当旧稿把下一个标题误并进 `【实战方法】` 时，不能只做表面句面替换，必须按标题边界恢复层级结构，再谈三步法收口。

### N1 听力人工收口批次 02

- 范围：
  - `N1_2011_12.json` 听力区 `2.01-2.05`
  - `N1_2013_07.json` 听力区 `2.01-2.05`
  - `N1_2013_12.json` 听力区 `2.01-2.05`
  - `N1_2014_07.json` 听力区 `2.01-2.05`
- 收口定位：
  - N2 实际卷顺推到头后，切回 N1 听力未完批次，按时间顺序从最早仍有残项的卷继续收口。
  - `N1_2011_12` 起手只剩 `1` 个旧口径残项；`N1_2013_07 / N1_2013_12 / N1_2014_07` 则仍整批保留旧方法段。
  - 四份卷的主要问题都集中在 `【实战方法】` 仍保留旧的一段式或非标准写法，未收成当前统一三步流程。
- 本轮人工判断：
  - 四份卷听力 `explanation / explanation_expand` 主体判断链整体可用，未发现系统性的答案错位、证据落点偏移或误选项张冠李戴。
  - `2011_12-2014_07` 这四份卷的主要缺口是方法段口径未统一，而不是正文判断逻辑错误。
  - 因此本轮按逐题复核后的结论，只收方法段，不改 `correct_answer`，也不重写可用正文。
- 本轮处理：
  - 对四份卷全部听力题逐题复核现有正文，不改 `correct_answer`。
  - 将 `2.01 課題理解`、`2.02 ポイント理解`、`2.03 概要理解`、`2.04 発話表現`、`2.05 即時応答` 的 `【实战方法】` 统一收为正式三步法。
  - 对四份卷中旧稿把 `【关键表达】` 串进 `【实战方法】` 的异常块，按标题边界重新切块，恢复为标准 `【实战方法】 + 【关键表达】` 层级。
  - 清理 `N1_2011_12 / 2.04-12` 补充层中残留的 `模板` 词面。
- 本轮结果：
  - `N1_2011_12` 听力区终检通过：`QCOUNT=36` / `RANGE=2.01-2.05`。
  - `N1_2013_07` 听力区终检通过：`QCOUNT=35` / `RANGE=2.01-2.05`。
  - `N1_2013_12` 听力区终检通过：`QCOUNT=36` / `RANGE=2.01-2.05`。
  - `N1_2014_07` 听力区终检通过：`QCOUNT=37` / `RANGE=2.01-2.05`。
  - 四份卷听力区 `【实战方法】` 均为三步流程。
  - 四份卷禁用信号复扫未命中。
  - 四份卷听力区 `correct_answer` 与 `HEAD` 对比保持不变。
  - `git diff --check` 通过，仅有既有 LF/CRLF 提示。
- 结构备注：
  - 当旧稿把下一个标题误并进 `【实战方法】` 时，不能只做表面句面替换，必须按标题边界恢复层级结构，再谈三步法收口。
  - `N1_2011_12` 属于“批次内只剩单点残项”的卷，日志必须写清它并非整卷大改，而是复核后做尾部收口。

### N1 听力人工收口批次 03

- 范围：
  - `N1_2014_12.json` 听力区 `2.01-2.05`
  - `N1_2015_07.json` 听力区 `2.01-2.05`
  - `N1_2015_12.json` 听力区 `2.01-2.05`
  - `N1_2016_07.json` 听力区 `2.01-2.05`
- 收口定位：
  - 继续按两年一批做 N1 听力人工逐题检查。
  - 本批四份卷起手均为整批旧方法段，主要问题集中在 `【实战方法】` 仍保留旧的一段式或非标准写法，未收成当前统一三步流程。
  - 四份卷旧稿都存在把 `【关键表达】` 串进 `【实战方法】` 区块的情况，本轮一并收平。
- 本轮人工判断：
  - 四份卷听力 `explanation / explanation_expand` 主体判断链整体可用，未发现系统性的答案错位、证据落点偏移或误选项张冠李戴。
  - `2014_12-2016_07` 这四份卷的主要缺口是方法段口径未统一，而不是正文判断逻辑错误。
  - 因此本轮按逐题复核后的结论，只收方法段，不改 `correct_answer`，也不重写可用正文。
- 本轮处理：
  - 对四份卷全部听力题逐题复核现有正文，不改 `correct_answer`。
  - 将 `2.01 課題理解`、`2.02 ポイント理解`、`2.03 概要理解`、`2.04 発話表現`、`2.05 即時応答` 的 `【实战方法】` 统一收为正式三步法。
  - 对四份卷中旧稿把 `【关键表达】` 串进 `【实战方法】` 的异常块，按标题边界重新切块，恢复为标准 `【实战方法】 + 【关键表达】` 层级。
- 本轮结果：
  - `N1_2014_12` 听力区终检通过：`QCOUNT=36` / `RANGE=2.01-2.05`。
  - `N1_2015_07` 听力区终检通过：`QCOUNT=37` / `RANGE=2.01-2.05`。
  - `N1_2015_12` 听力区终检通过：`QCOUNT=36` / `RANGE=2.01-2.05`。
  - `N1_2016_07` 听力区终检通过：`QCOUNT=36` / `RANGE=2.01-2.05`。
  - 四份卷听力区 `【实战方法】` 均为三步流程。
  - 四份卷禁用信号复扫未命中。
  - 四份卷听力区 `correct_answer` 与 `HEAD` 对比保持不变。
  - `git diff --check` 通过。
- 结构备注：
  - 当旧稿把下一个标题误并进 `【实战方法】` 时，不能只做表面句面替换，必须按标题边界恢复层级结构，再谈三步法收口。
  - 本批四份卷题量并不完全一致，记账时仍按当前文件实物的 `QCOUNT=36 / 37 / 36 / 36` 分别记录，不做机械并齐。



### N1 听力人工收口批次 04

- 范围：
  - `N1_2016_12.json` 听力区 `2.01-2.05`
  - `N1_2017_07.json` 听力区 `2.01-2.05`
  - `N1_2017_12.json` 听力区 `2.01-2.05`
  - `N1_2018_07.json` 听力区 `2.01-2.05`
- 收口定位：
  - 继续按两年一批做 N1 听力人工逐题检查。
  - `N1_2016_12 / N1_2017_07` 仍是整批旧的一段式 `【实战方法】`；`N1_2017_12` 只剩 `2.05` 下的少量尾项；`N1_2018_07` 则主要是四步法方法段。
  - 四份卷的主要缺口都集中在 `【实战方法】` 未收成当前统一三步流程，而不是答案判断链本身。
- 本轮人工判断：
  - 四份卷听力 `explanation / explanation_expand` 主体判断链整体可用，未发现系统性的答案错位、证据落点偏移或误选项张冠李戴。
  - `N1_2017_12` 属于批次内尾部残项卷，题量完整，但需要实改的题位只落在 `2.05` 的少量题上。
  - 因此本轮按逐题复核后的结论，只收方法段，不改 `correct_answer`，也不重写可用正文。
- 本轮处理：
  - 对四份卷全部听力题逐题复核现有正文，不改 `correct_answer`。
  - 将 `2.01 課題理解`、`2.02 ポイント理解`、`2.03 概要理解`、`2.04 発話表現`、`2.05 即時応答` 的 `【实战方法】` 统一收为正式三步法。
  - 对 `N1_2018_07` 中旧的四步法方法段，按当前标准压回统一三步流程。
- 本轮结果：
  - `N1_2016_12` 听力区终检通过：`QCOUNT=36` / `RANGE=2.01-2.05`。
  - `N1_2017_07` 听力区终检通过：`QCOUNT=34` / `RANGE=2.01-2.05`。
  - `N1_2017_12` 听力区终检通过：`QCOUNT=35` / `RANGE=2.01-2.05`。
  - `N1_2018_07` 听力区终检通过：`QCOUNT=35` / `RANGE=2.01-2.05`。
  - 四份卷听力区 `【实战方法】` 均为三步流程。
  - 四份卷禁用信号复扫未命中。
  - 四份卷听力区 `correct_answer` 与 `HEAD` 对比保持不变。
  - `git diff --check` 通过，仅有既有 LF/CRLF 提示。
- 结构备注：
  - 老卷听力区不能假设题目直接挂在 section 下；本批仍需按 `sections[].passages[].questions[]` 的真实结构处理。
  - `N1_2017_12` 虽然命中数少，但仍按整卷逐题复核记账，不能因为只剩尾项就跳过人工核对。


### N1 听力人工收口批次 05

- 范围：
  - `N1_2018_12.json` 听力区 `2.01-2.05`
  - `N1_2019_07.json` 听力区 `2.01-2.05`
  - `N1_2019_12.json` 听力区 `2.01-2.05`
  - `N1_2020_12.json` 听力区 `2.01-2.05`
- 空模板备注：
  - `N1_2020_07.json` 当前 `sections=[]`，不计入实际收口卷。
- 收口定位：
  - 继续按两年一批做 N1 听力人工逐题检查。
  - `N1_2018_12` 起手只剩 `12` 个旧方法段残项；`N1_2019_07 / N1_2019_12 / N1_2020_12` 则仍是整批旧的一段式 `【实战方法】`。
  - 本批主要缺口仍集中在方法段口径未统一，而不是答案判断链本身。
- 本轮人工判断：
  - 四份卷听力 `explanation / explanation_expand` 主体判断链整体可用，未发现系统性的答案错位、证据落点偏移或误选项张冠李戴。
  - 本轮校验时确认 N1 当前文件中 `2.04` 为 `即時応答`，`2.05` 为 `統合理解`，不能沿用 N2/N3 的题型映射。
  - 因此本轮按真实 `section_name` 对 `2.04 / 2.05` 方法段做题型纠偏。
- 本轮处理：
  - 对四份卷全部听力题逐题复核现有正文，不改 `correct_answer`。
  - 将 `2.01 課題理解`、`2.02 ポイント理解`、`2.03 概要理解` 的 `【实战方法】` 统一收为正式三步法。
  - 将 N1 `2.04 即時応答` 统一为“判断会话功能 → 判断回应功能 → 排除礼貌但跑题回应”的三步流程。
  - 将 N1 `2.05 統合理解` 统一为“人物条件简表 → 追踪修正定案 → 按问题回填答案”的三步流程。
- 关联回补：
  - 同步回补已收口 N1 批次 `N1_2011_12` 到 `N1_2018_07` 的 `2.04 / 2.05` 方法段，确保 N1 听力题型映射一致。
  - 回补只动 `【实战方法】`，不改答案、不改主体判断链。
- 本轮结果：
  - `N1_2018_12` 听力区终检通过：`QCOUNT=35` / `RANGE=2.01-2.05`。
  - `N1_2019_07` 听力区终检通过：`QCOUNT=35` / `RANGE=2.01-2.05`。
  - `N1_2019_12` 听力区终检通过：`QCOUNT=35` / `RANGE=2.01-2.05`。
  - `N1_2020_12` 听力区终检通过：`QCOUNT=35` / `RANGE=2.01-2.05`。
  - 当前批次四份卷听力区 `【实战方法】` 均为三步流程。
  - 已触达 N1 听力旧批次合计 `569` 题复扫通过：方法段三步、禁用信号、`correct_answer` 对比均为 `0` 问题。
  - `git diff --check` 通过，仅有既有 LF/CRLF 提示。
- 结构备注：
  - N1 听力不能只按题号套模板，必须同时核 `section_name`；尤其 `2.05` 在本批是 `統合理解`，应使用综合理解听题流程。
  - 后续 N1 批次继续按当前 N1 题型映射推进，避免和 N2/N3 题型顺序混用。


### N1 听力人工收口批次 06

- 范围：
  - `N1_2021_07.json` 听力区 `2.01-2.05`
  - `N1_2021_12.json` 听力区 `2.01-2.05`
  - `N1_2022_07.json` 听力区 `2.01-2.05`
  - `N1_2022_12.json` 听力区 `2.01-2.05`
- 收口定位：
  - 继续按两年一批做 N1 听力人工逐题检查。
  - 四份卷起手均为旧的一段式 `【实战方法】`，主要缺口是方法段未按当前标准三步化。
  - 本批确认 N1 题型映射为 `2.04 即時応答`、`2.05 統合理解`，沿用上一批纠偏后的 N1 专用方法段。
- 本轮人工判断：
  - 四份卷听力 `explanation / explanation_expand` 主体判断链整体可用，未发现系统性的答案错位、证据落点偏移或误选项张冠李戴。
  - `N1_2022_12` 当前实物题量为 `30` 题，少于前三份卷的 `35` 题，记账按文件实际结构处理。
  - 因此本轮按逐题复核后的结论，只收方法段，不改 `correct_answer`，也不重写可用正文。
- 本轮处理：
  - 对四份卷全部听力题逐题复核现有正文，不改 `correct_answer`。
  - 将 `2.01 課題理解`、`2.02 ポイント理解`、`2.03 概要理解` 的 `【实战方法】` 统一收为正式三步法。
  - 将 N1 `2.04 即時応答` 统一为“判断会话功能 → 判断回应功能 → 排除礼貌但跑题回应”的三步流程。
  - 将 N1 `2.05 統合理解` 统一为“人物条件简表 → 追踪修正定案 → 按问题回填答案”的三步流程。
- 本轮结果：
  - `N1_2021_07` 听力区终检通过：`QCOUNT=35` / `RANGE=2.01-2.05`。
  - `N1_2021_12` 听力区终检通过：`QCOUNT=35` / `RANGE=2.01-2.05`。
  - `N1_2022_07` 听力区终检通过：`QCOUNT=35` / `RANGE=2.01-2.05`。
  - `N1_2022_12` 听力区终检通过：`QCOUNT=30` / `RANGE=2.01-2.05`。
  - 四份卷听力区 `【实战方法】` 均为三步流程。
  - 四份卷禁用信号复扫未命中。
  - 四份卷听力区 `correct_answer` 与 `HEAD` 对比保持不变。
  - `git diff --check` 通过，仅有既有 LF/CRLF 提示。
- 结构备注：
  - 后续 N1 批次继续优先读取 `section_name`，再决定 `2.04 / 2.05` 的方法模板，避免只按题号套错题型。


### N1 听力人工收口批次 07

- 范围：
  - `N1_2023_07.json` 听力区 `2.01-2.05`
  - `N1_2023_12.json` 听力区 `2.01-2.05`
  - `N1_2024_07.json` 听力区 `2.01-2.05`
  - `N1_2024_12.json` 听力区 `2.01-2.05`
  - `N1_2025_07.json` 听力区 `2.01-2.05`
- 空模板备注：
  - `N1_2025_12.json` 当前 `sections=[]`，不计入实际收口卷。
- 收口定位：
  - 继续按 N1 听力实际卷顺推；因 `N1_2025_07` 也是实际卷，本批一并收口，避免只留下单卷尾项。
  - 五份卷起手均为旧的一段式 `【实战方法】`，主要缺口是方法段未按当前标准三步化。
  - 本批继续按 N1 真实题型映射处理：`2.04 即時応答`，`2.05 統合理解`。
- 本轮人工判断：
  - 五份卷听力 `explanation / explanation_expand` 主体判断链整体可用，未发现系统性的答案错位、证据落点偏移或误选项张冠李戴。
  - 五份卷当前实物题量均为 `30` 题，记账按当前文件结构处理。
  - 因此本轮按逐题复核后的结论，只收方法段，不改 `correct_answer`，也不重写可用正文。
- 本轮处理：
  - 对五份卷全部听力题逐题复核现有正文，不改 `correct_answer`。
  - 将 `2.01 課題理解`、`2.02 ポイント理解`、`2.03 概要理解` 的 `【实战方法】` 统一收为正式三步法。
  - 将 N1 `2.04 即時応答` 统一为“判断会话功能 → 判断回应功能 → 排除礼貌但跑题回应”的三步流程。
  - 将 N1 `2.05 統合理解` 统一为“人物条件简表 → 追踪修正定案 → 按问题回填答案”的三步流程。
- 本轮结果：
  - `N1_2023_07` 听力区终检通过：`QCOUNT=30` / `RANGE=2.01-2.05`。
  - `N1_2023_12` 听力区终检通过：`QCOUNT=30` / `RANGE=2.01-2.05`。
  - `N1_2024_07` 听力区终检通过：`QCOUNT=30` / `RANGE=2.01-2.05`。
  - `N1_2024_12` 听力区终检通过：`QCOUNT=30` / `RANGE=2.01-2.05`。
  - `N1_2025_07` 听力区终检通过：`QCOUNT=30` / `RANGE=2.01-2.05`。
  - 五份卷听力区 `【实战方法】` 均为三步流程。
  - 五份卷禁用信号复扫未命中。
  - 五份卷听力区 `correct_answer` 与 `HEAD` 对比保持不变。
  - N1 听力实际卷全库复扫通过：`30` 份实际卷，`1033` 题，方法段与禁用信号均为 `0` 问题。
  - `git diff --check` 通过，仅有既有 LF/CRLF 提示。
- 结构备注：
  - 按当前文件实物，N1 听力实际卷已顺推到头；后续 `N1_2025_12` 目前为空模板，不能计作实题完成。
