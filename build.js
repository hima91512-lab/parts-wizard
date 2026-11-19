// node build.js  → compiles src/app.jsx to app.js and copies index.html to the site root
const Babel = require(process.env.BABEL || '/home/claude/catdate/pkgs/x/babel-standalone-7.26.4/package/babel.min.js');
const fs = require('fs');
fs.writeFileSync('app.js', Babel.transform(fs.readFileSync('src/app.jsx','utf8'), { presets:[['env',{targets:'safari 14, chrome 90'}],'react'] }).code);
fs.copyFileSync('src/index.html', 'index.html');
