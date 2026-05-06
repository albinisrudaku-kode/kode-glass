const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const {AngularWebpackPlugin} = require('@ngtools/webpack');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';
  const extensionBundleBudget = 1.5 * 1024 * 1024;
  const taigaIcons = ['sun.svg', 'moon.svg', 'rotate-ccw.svg', 'chevron-down.svg', 'copy.svg', 'settings.svg'];

  return {
    mode: isProduction ? 'production' : 'development',
    devtool: isProduction ? false : 'source-map',
    entry: {
      'analysis-runner': './src/content-script/analysis-runner.ts',
      'side-panel': ['./src/side-panel/styles.less', './src/side-panel/main.ts'],
      background: './src/background/index.ts',
      'content-script': './src/content-script/index.ts'
    },
    output: {
      clean: true,
      filename: '[name].js',
      path: path.resolve(__dirname, 'dist')
    },
    resolve: {
      extensions: ['.ts', '.mjs', '.js']
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          loader: '@ngtools/webpack'
        },
        {
          test: /\.[cm]?js$/,
          include: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              cacheDirectory: true,
              compact: false,
              plugins: ['@angular/compiler-cli/linker/babel']
            }
          }
        },
        {
          test: /\.css$/,
          resourceQuery: /ngResource/,
          type: 'javascript/auto',
          use: [
            {
              loader: 'css-loader',
              options: {
                exportType: 'string'
              }
            }
          ]
        },
        {
          test: /\.less$/,
          include: path.resolve(__dirname, 'src/side-panel/styles.less'),
          use: [MiniCssExtractPlugin.loader, 'css-loader', 'less-loader']
        }
      ]
    },
    optimization: {
      runtimeChunk: false,
      splitChunks: false
    },
    performance: isProduction ? {
      maxAssetSize: extensionBundleBudget,
      maxEntrypointSize: extensionBundleBudget
    } : false,
    plugins: [
      new AngularWebpackPlugin({
        tsconfig: path.resolve(__dirname, 'tsconfig.app.json')
      }),
      new MiniCssExtractPlugin({
        filename: '[name].css'
      }),
      new HtmlWebpackPlugin({
        chunks: ['side-panel'],
        filename: 'side-panel.html',
        template: './src/side-panel/index.html'
      }),
      new CopyPlugin({
        patterns: [
          {from: 'public', to: '.'},
          ...taigaIcons.map(icon => ({
            from: `node_modules/@taiga-ui/icons/src/${icon}`,
            noErrorOnMissing: true,
            to: `assets/taiga-ui/icons/${icon}`
          }))
        ]
      }),
      new webpack.DefinePlugin({
        __ATLASSIAN_OAUTH_CLIENT_ID__: JSON.stringify(process.env.ATLASSIAN_OAUTH_CLIENT_ID || '')
      })
    ]
  };
};
