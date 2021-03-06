var fs = require("fs");
var path = require("path");
var chalk = require("chalk");
var glob = require("glob");
var diff = require("./util/diff");

require("ts-node").register({ project: require("path").join(__dirname, "..", "src") });
require("../src/glue/js");

var Compiler = require("../src/compiler").Compiler;
var Module = require("../src/module").Module;
var Parser = require("../src/parser").Parser;

var isCreate = process.argv[2] === "--create";
var filter = process.argv.length > 2 && !isCreate ? "**/" + process.argv[2] + ".ts" : "**/*.ts";

var stdFiles = glob.sync("*.ts", { cwd: __dirname + "/../std/assembly" });

glob.sync(filter, { cwd: __dirname + "/compiler" }).forEach(filename => {
  if (filename.charAt(0) == "_")
    return;

  console.log(chalk.default.whiteBright("Testing compiler/" + filename));

  var fixture = path.basename(filename, ".ts");
  var parser = new Parser();
  if (filename.startsWith("std/")) {
    stdFiles.forEach(file => {
      parser.parseFile(fs.readFileSync(__dirname + "/../std/assembly/" + file, { encoding: "utf8" }), file, false);
    });
    fixture = "std/" + fixture;
  }

  var sourceText = fs.readFileSync(__dirname + "/compiler/" + filename, { encoding: "utf8" });
  parser.parseFile(sourceText, filename, true);
  var nextFile;
  while ((nextFile = parser.nextFile()) !== null) {
    var nextSourceText;
    try {
      nextSourceText = fs.readFileSync(path.join(__dirname, "compiler", nextFile + ".ts"), { encoding: "utf8" });
    } catch (e) {
      nextSourceText = fs.readFileSync(path.join(__dirname, "compiler", nextFile, "index.ts"), { encoding: "utf8" });
    }
    parser.parseFile(nextSourceText, nextFile, false);
  }
  var program = parser.finish();
  var module = Compiler.compile(program);
  var actual = module.toText() + "(;\n[program.elements]\n  " + iterate(program.elements.keys()).join("\n  ") + "\n[program.exports]\n  " + iterate(program.exports.keys()).join("\n  ") + "\n;)\n";
  var actualOptimized = null;
  var actualInlined = null;

  if (module.validate()) {
    console.log(chalk.default.green("validate OK"));
    try {
      module.interpret();
      console.log(chalk.default.green("interpret OK"));
    } catch (e) {
      process.exitCode = 1;
      console.log(chalk.default.red("interpret ERROR"));
    }
    module.optimize();
    actualOptimized = module.toText();
    module.runPasses([ "inlining" ]);
    actualInlined = module.toText();
  } else {
    process.exitCode = 1;
    console.log(chalk.default.red("validate ERROR"));
  }

  if (isCreate) {
    fs.writeFileSync(__dirname + "/compiler/" + fixture + ".wast", actual, { encoding: "utf8" });
    console.log("Created");
    if (actualOptimized != null) {
      fs.writeFileSync(__dirname + "/compiler/" + fixture + ".optimized.wast", actualOptimized, { encoding: "utf8" });
      console.log("Created optimized");
    }
    if (actualInlined != null) {
      if (actualInlined != actualOptimized) {
        fs.writeFileSync(__dirname + "/compiler/" + fixture + ".optimized-inlined.wast", actualInlined, { encoding: "utf8" });
        console.log("Created optimized & inlined");
      } else {
        try {
          fs.unlinkSync(__dirname + "/compiler/" + fixture + ".optimized-inlined.wast");
          console.log("Deleted optimized & inlined");
        } catch (e) {}
      }
    }
  } else {
    try {
      var expected = fs.readFileSync(__dirname + "/compiler/" + fixture + ".wast", { encoding: "utf8" });
      var diffs = diff(filename + ".wast", expected, actual);
      if (diffs !== null) {
        process.exitCode = 1;
        console.log(diffs);
        console.log(chalk.default.red("diff ERROR"));
      } else {
        console.log(chalk.default.green("diff OK"));
      }
    } catch (e) {
      process.exitCode = 1;
      console.log(e.message);
      console.log(chalk.default.red("diff ERROR"));
    }
  }

  module.dispose();
  console.log();
});

function iterate(it) {
  var current;
  var arr = [];
  while ((current = it.next()) && !current.done)
    arr.push(current.value);
  return arr;
}
