const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  mode: 'production',

  entry: {
    background: './background.js',
    content: './content.js',
  },

  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true,
  },

  experiments: {
    asyncWebAssembly: true,
  },

  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: 'manifest.json', to: '.' },
      ],
    }),
  ],

  resolve: {
    extensions: ['.js', '.wasm'],
    // @xenova/transformers references Node built-ins; stub them out for the browser bundle.
    fallback: {
      fs: false,
      path: false,
      crypto: false,
      os: false,
      url: false,
    },
  },

  // Suppress the expected size warning from bundling transformers.js models loader.
  performance: {
    hints: false,
  },
};
