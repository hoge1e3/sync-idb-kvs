const entries={
  //esm: './src/index.js',
  //worker: './test/worker.js',
  test: "./test/test.js",
};
const outputs={
  /*esm: {
    libraryTarget: 'module',
    path: `${__dirname}/dist`,
    filename: "index.js",
  },
  worker: {
    libraryTarget: 'module',
    path: `${__dirname}/test`,
    filename: "worker.webpack.js",
  },*/
  test: {
    libraryTarget: 'module',
    path: `${__dirname}/test`,
    filename: "test.webpack.js",
  },
};
module.exports = (env,argv)=>[/*"esm",*/"test",/*"worker"*/].map((type)=>({
    // モード値を production に設定すると最適化された状態で、
    // development に設定するとソースマップ有効でJSファイルが出力される
    mode: 'development',
    // メインとなるJavaScriptファイル（エントリーポイント）
    entry: entries[type],
    experiments: {
    	outputModule: type!=="umd",
    },
    output: outputs[type],
    module: {
        rules: [
            /*{
                // 拡張子 .ts の場合
                test: /\.ts$/,
                // TypeScript をコンパイルする
                use: {
        			loader:'ts-loader',
        		},
            },*/
        ],
        parser: {
          javascript: {
            importMeta: !env.production,
          },
        },
    },
    resolve: {
        // 拡張子を配列で指定
        extensions: [
            '.js',
        ],
    },
    plugins: [
    ],
}));
