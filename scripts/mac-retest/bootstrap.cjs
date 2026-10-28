// 用开发版 Electron 跑安装包里的 DocDiff（DD_MAIN 指向 app.asar/electron/main.cjs），
// 并把用户数据放到测试用的临时目录：不碰你自己的设置、最近比较和审阅记录。
const { app } = require('electron');
const path = require('path'), os = require('os');
app.setPath('userData', path.join(process.env.XDG_CONFIG_HOME || os.tmpdir(), 'DocDiff'));
require(process.env.DD_MAIN);
