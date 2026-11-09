// 1.9.2 新增文案的英文（审阅稿离开界面后的补写；术语：Redline = 审阅稿）
export const EN_192: Record<string, string> = {
  '上次离开时有 {n} 个决定没写进去，正在补写…': '{n} decisions were not written last time. Writing them now…',
  '还有 {n} 个决定没写进这份审阅稿': '{n} decisions are not in this redline yet',
  'Word 正在使用这份审阅稿': 'Word has this redline open',
  '审阅稿在 DocDiff 之外被改过，为了不覆盖已暂停': 'The redline was changed outside DocDiff, so writing is paused to keep those changes',
  '审阅稿被移走或删除了': 'The redline was moved or deleted',
  '文件夹写不进去': 'The folder is not writable',
  '写入出错{e}': 'Could not write{e}',
  '还没来得及写完': 'Not finished writing',
  '还有决定没写进审阅稿': 'Some decisions are not in the redline',
  '上次有决定没写进审阅稿': 'Some decisions were not written to the redline last time',
  '有决定没写进审阅稿': 'Some decisions are not in the redline',
  '先不退出': 'Don’t quit',
  '仍然退出': 'Quit anyway',
  '{n} 个决定没写进去': '{n} decisions not written',
  '这些决定都保存在 DocDiff 里，不会丢。在这份审阅稿写好之前，不要把它发给对方。': 'These decisions are saved in DocDiff and won’t be lost. Don’t send this redline until it’s up to date.',
  '再打开这次比较时会自动补写；Word 正在用时，先在 Word 里关掉它。': 'They are written automatically the next time you open this comparison. If Word has the file open, close it in Word first.',
};
