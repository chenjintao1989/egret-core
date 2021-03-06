var path = require("path");
var param = require("../core/params_analyze.js");
var globals = require("../core/globals");
var file = require("../core/file.js");
var compile = require("../tools/compile.js");

var screening = require("../tools/screeningfiles");

var closureCompiler = require("../core/closureCompiler");
var zip = require("../core/createzip.js");

var filelist = require("../core/getProjectFilelist.js");
var genVer = require("../tools/generate_version");
var projectProperties = require("../core/projectProperties.js");
var async = require('../core/async');

function run(dir, args, opts) {
    if (opts["-testJava"]) {
        closureCompiler.checkUserJava();
        return;
    }

    var currDir = globals.joinEgretDir(dir, args[0]);
    globals.checkVersion(currDir);
    globals.setShowDebugLog();

    projectProperties.init(currDir);

    var versionFile = "";
    if (opts["--version"]) {
        versionFile = opts["--version"][0];
    }
    if (versionFile == null || versionFile == "") {
        versionFile = Math.round(Date.now() / 1000);
    }

    var runtime = param.getOption(opts, "--runtime", ["html5", "native"]);
    if (runtime == "native") {
        publishNative(opts, versionFile);
    }
    else {
        publishHtml5(opts, versionFile);
    }
}

function getCompilePath(opts) {
    var compilepath = "";
    if (param.getArgv()["opts"]["--method"] && param.getArgv()["opts"]["--method"] == "uglify") {
        compilepath = "../uglify-js/uglify_adapt";
    }
    else {
        compilepath = "../core/closureCompiler";
    }
    return compilepath;
}

function publishNative(opts, versionFile) {

    var timeMinSec = Date.now();

    globals.log2(1402, "native", versionFile + "");

    var projectPath = projectProperties.getProjectPath();
    var releasePath = path.join(projectPath, projectProperties.getReleaseUrl());
    var ziptempPath = path.join(releasePath, "ziptemp");
    file.remove(ziptempPath);

    var releaseOutputPath = path.join(releasePath, "android", versionFile + "");
    if (file.exists(releaseOutputPath)) {
        file.remove(releaseOutputPath);
    }
    file.createDirectory(releaseOutputPath);

    var task = [];

    //js文件
    //获取gamelist以及egretlist
    var file_list = filelist.getAllFileList(projectPath, "native");
    var needCompile = (opts["-compile"] || opts["-compiler"]) ? true : false;
    if (needCompile) {//压缩js文件，并拷贝到ziptemp目录中
        task.push(function (tempCallback) {
            var tempTime = Date.now();
            globals.debugLog(1403);

            var compilePath = getCompilePath();
            var adapt = require(compilePath);
            adapt.compilerSingleFile(file_list, path.join(ziptempPath, "launcher", "game-min-native.js"), path.join(ziptempPath, "launcher", "__game-min-native.js"), function() {
                globals.debugLog(1404, (Date.now() - tempTime) / 1000);
                tempCallback();
            });
        });
    }
    else {
        task.push(function (tempCallback) {
            var tempTime = Date.now();
            //拷贝到ziptemp目录中
            globals.debugLog(1405);
            file_list.map(function (item) {
                var re = path.relative(projectPath, item);
                file.copy(item, path.join(ziptempPath, re));
            });

            file.copy(path.join(projectPath, "bin-debug", "lib", "egret_file_list_native.js"), path.join(ziptempPath, "bin-debug", "lib", "egret_file_list.js"));
            file.copy(path.join(projectPath, "bin-debug", "src", "game_file_list.js"), path.join(ziptempPath, "bin-debug", "src", "game_file_list.js"));

            globals.debugLog(1406, (Date.now() - tempTime) / 1000);
            tempCallback();
        });
    }

    //生成版本控制文件到nativeBase里
    var noVerion = (opts["-noversion"]) ? true : false;
    if (!noVerion) {
        task.push(function (tempCallback) {
            //是否要重新生成当前版本的baseVersion文件
            var freshBaseVersion = (opts["-freshBaseVersion"]) ? true : false;
            if (freshBaseVersion) {
                file.remove(path.join(releasePath, "nativeBase"));
            }

            var tempTime = Date.now();
            globals.debugLog(1407);

            genVer.generate(projectPath, path.join(releasePath, "nativeBase"), projectProperties.getVersionCode("native"), projectProperties.getIgnorePath());

            globals.debugLog(1408, (Date.now() - tempTime) / 1000);
            tempCallback();
        });
    }

    if (true) {//拷贝其他需要打到zip包里的文件
        task.push(function (tempCallback) {
            //拷贝需要zip的文件
            file.copy(path.join(projectPath, "launcher", "native_loader.js"), path.join(ziptempPath, "launcher", "native_loader.js"));
            file.copy(path.join(projectPath, "launcher", "runtime_loader.js"), path.join(ziptempPath, "launcher", "runtime_loader.js"));
            file.copy(path.join(projectPath, "launcher", "native_require.js"), path.join(ziptempPath, "launcher", "native_require.js"));
            if (noVerion) {
                file.save(path.join(ziptempPath, "version.manifest"), "{}");
                file.save(path.join(ziptempPath, "code.manifest"), JSON.stringify({code:1}));
            }
            else {
                file.copy(path.join(releasePath, "nativeBase", "version.manifest"), path.join(ziptempPath, "version.manifest"));
                file.copy(path.join(releasePath, "nativeBase", "code.manifest"), path.join(ziptempPath, "code.manifest"));
            }


            if (file.exists(path.join(ziptempPath, "launcher", "native_require.js"))) {
                var native_require = file.read(path.join(ziptempPath, "launcher", "native_require.js"));
                native_require = native_require.replace(/var needCompile =.*/, "var needCompile = " + (needCompile ? "true" : "false") + ";");
                file.save(path.join(ziptempPath, "launcher", "native_require.js"), native_require);
            }

            tempCallback();
        });
    }

    //打zip包
    var nozip = opts["-nozip"];
    if (nozip) {//不需要打zip包
        task.push(function (tempCallback) {
            var tempTime = Date.now();
            globals.debugLog(1414);
            file.copy(ziptempPath, releaseOutputPath);
            file.remove(ziptempPath);
            globals.debugLog(1409, (Date.now() - tempTime) / 1000);
            tempCallback();
        });
    }
    else {//打zip包
        task.push(function (tempCallback) {
            var tempTime = Date.now();
            globals.debugLog(1410);
            var password = getPassword(opts);
            var zipFile = path.join(releaseOutputPath, "game_code_" + versionFile + ".zip");
            zip.createZipFile(ziptempPath, zipFile, function () {
                file.remove(ziptempPath);

                globals.debugLog(1411, (Date.now() - tempTime) / 1000);
                tempCallback();
            }, password);
        });
    }

    //拷贝其他资源文件
    if (true) {//拷贝其他文件到发布目录
        task.push(function (tempCallback) {
            copyFilesWithIgnore(path.join(projectPath, "resource"), path.join(releaseOutputPath, "resource"));

            if (nozip) {
                file.save(path.join(releaseOutputPath, "appVersion.manifest"), JSON.stringify({"version":Date.now(), "debug":1}));
            }
            else {
                file.save(path.join(releaseOutputPath, "appVersion.manifest"), JSON.stringify({"version":Date.now()}));
            }

            if (noVerion) {
                file.save(path.join(releaseOutputPath, "base.manifest"), "{}");
            }
            else {
                file.copy(path.join(releasePath, "nativeBase", "base.manifest"), path.join(releaseOutputPath, "base.manifest"));

                var baseJson = JSON.parse(file.read(path.join(releasePath, "nativeBase", "base.manifest")));
                var versionJson = JSON.parse(file.read(path.join(releasePath, "nativeBase", "version.manifest")));

                for (var key in versionJson) {
                    if (versionJson[key]["d"] == 1) {
                        delete baseJson[key];
                    }
                    else if (baseJson[key] == null || versionJson[key]["v"] != baseJson[key]["v"]) {
                        baseJson[key] = versionJson[key];
                    }
                }
                file.save(path.join(releaseOutputPath, "localVersion.manifest"), JSON.stringify(baseJson));
            }

            compressJson(releaseOutputPath);
            tempCallback();
        });
    }

    //拷贝到native工程中
    if (true) {
        task.push(function (tempCallback) {
            var startTime = Date.now();

            //apk
            if (projectProperties.getNativePath("android")) {
                var url1 = path.join(projectProperties.getProjectPath(), projectProperties.getNativePath("android"), "proj.android");
                var url2 = path.join(projectProperties.getProjectPath(), projectProperties.getNativePath("android"), "proj.android/assets");
                if (file.exists(url1)) {//是egret的android项目
                    //1、清除文件夹
                    file.remove(path.join(url2, "egret-game"));
                    file.createDirectory(path.join(url2, "egret-game"));
                    file.copy(releaseOutputPath, path.join(url2, "egret-game"));

                    //修改java文件
                    var javaEntr = require('../core/changeJavaEntrance');
                    if (nozip) {
                        javaEntr.changeBuild(url1, "android");
                    }
                    else {
                        javaEntr.changePublish(url1, "android", versionFile);
                    }
                }
            }

            if (projectProperties.getNativePath("ios")) {
                var url1 = path.join(projectProperties.getProjectPath(), projectProperties.getNativePath("ios"), "proj.ios");
                var url2 = path.join(projectProperties.getProjectPath(), projectProperties.getNativePath("ios"), "Resources");

                if (file.exists(url1)
                    && file.exists(url2)) {//是egret的ios项目
                    //1、清除文件夹
                    file.remove(path.join(url2, "egret-game"));

                    file.createDirectory(path.join(url2, "egret-game"));
                    file.copy(releaseOutputPath, path.join(url2, "egret-game"));
                }
            }

            globals.log2(1412, (Date.now() - startTime) / 1000);

            tempCallback();
        });
    }


    async.series(task, function (err) {
        if (!err) {
            globals.log2(1413, (Date.now() - timeMinSec) / 1000);
        }
        else {
            globals.exit(err);
        }
    });


    function copyFilesWithIgnore(sourceRootPath, desRootPath) {
        var copyFilePathList = file.getDirectoryAllListing(path.join(sourceRootPath));

        var ignorePathList = projectProperties.getIgnorePath();
        ignorePathList = ignorePathList.map(function(item) {

            var reg = new RegExp(item);
            return reg;
        });

        var isIgnore = false;
        copyFilePathList.forEach(function(copyFilePath) {
            isIgnore = false;

            for (var key in ignorePathList) {//检测忽略列表
                var ignorePath = ignorePathList[key];

                if (copyFilePath.match(ignorePath)) {
                    isIgnore = true;
                    break;
                }
            }

            if(!isIgnore) {//不在忽略列表的路径，拷贝过去
                var copyFileRePath = path.relative(sourceRootPath, copyFilePath);
                file.copy(path.join(copyFilePath), path.join(desRootPath, copyFileRePath));
            }
        });
    }
}

function publishHtml5(opts, versionFile) {
    var timeMinSec = Date.now();

    globals.log2(1402, "html5", versionFile + "");

    var projectPath = projectProperties.getProjectPath();
    var releasePath = path.join(projectPath, projectProperties.getReleaseUrl());

    var releaseOutputPath = path.join(releasePath, "html5", versionFile + "");
    if (file.exists(releaseOutputPath)) {
        file.remove(releaseOutputPath);
    }
    file.createDirectory(releaseOutputPath);

    var task = [];

    //js文件
    //获取gamelist以及egretlist
    var file_list = filelist.getAllFileList(projectPath, "html5");
    var needCompile = (opts["-compile"] || opts["-compiler"]) ? true : false;

    if (true) {//压缩js文件，并拷贝到ziptemp目录中
        task.push(function (tempCallback) {
            var tempTime = Date.now();
            globals.debugLog(1403);

            var compilePath = getCompilePath();
            var adapt = require(compilePath);
            adapt.compilerSingleFile(file_list, path.join(releaseOutputPath, "launcher", "game-min.js"), path.join(releaseOutputPath, "launcher", "__game-min.js"), function() {
                globals.debugLog(1404, (Date.now() - tempTime) / 1000);
                tempCallback();
            });
        });
    }
    else {
        task.push(function (tempCallback) {
            var tempTime = Date.now();
            //拷贝到ziptemp目录中
            globals.debugLog(1405);
            file_list.map(function (item) {
                var re = path.relative(projectPath, item);
                file.copy(item, path.join(releaseOutputPath, re));
            });

            file.copy(path.join(projectPath, "bin-debug", "lib", "egret_file_list.js"), path.join(releaseOutputPath, "bin-debug", "lib", "egret_file_list.js"));
            file.copy(path.join(projectPath, "bin-debug", "src", "game_file_list.js"), path.join(releaseOutputPath, "bin-debug", "src", "game_file_list.js"));

            globals.debugLog(1406, (Date.now() - tempTime) / 1000);
            tempCallback();
        });
    }

    //生成版本控制文件到nativeBase里
    var noVerion = true;//(opts["-noversion"]) ? true : false;
    //if (!noVerion) {
    //    task.push(function (tempCallback) {
    //        var tempTime = Date.now();
    //        globals.debugLog("扫描版本控制文件");
    //
    //        genVer.generate(projectPath, path.join(releasePath, "html5Base"), projectProperties.getVersionCode("html5"));
    //
    //        globals.debugLog("生成版本控制文件耗时：%d秒", (Date.now() - tempTime) / 1000);
    //        tempCallback();
    //    });
    //}


    if (true) {//拷贝其他文件
        task.push(function (tempCallback) {
            //拷贝
            //拷贝版本控制文件
            if (noVerion) {
                file.save(path.join(releaseOutputPath, "version.manifest"), "{}");
            }
            else {
                file.copy(path.join(releasePath, "html5Base", "version.manifest"), path.join(releaseOutputPath, "version.manifest"));
            }

            //拷贝release.html到外面，并且改名为index.html
            file.copy(path.join(projectPath, "launcher", "release.html"), path.join(releaseOutputPath, "index.html"));

            //拷贝其他的launcher内文件
            copyFilesWithIgnoreList(path.join(projectPath, "launcher"), path.join(releaseOutputPath, "launcher"),
                ["game-min.js", "index.html", "release.html", "native_loader.js", "runtime_loader.js", "native_require.js"]);
            tempCallback();
        });
    }

    //拷贝其他资源文件
    if (true) {//拷贝
        task.push(function (tempCallback) {
            file.copy(path.join(projectPath, "resource"), path.join(releaseOutputPath, "resource"));

            if (noVerion) {
                file.save(path.join(releaseOutputPath, "base.manifest"), "{}");
            }
            else {
                file.copy(path.join(releasePath, "html5Base", "base.manifest"), path.join(releaseOutputPath, "base.manifest"));
            }


            compressJson(releaseOutputPath);

            tempCallback();
        });
    }

    async.series(task, function (err) {
        if (!err) {
            globals.log2(1413, (Date.now() - timeMinSec) / 1000);
        }
        else {
            globals.exit(err);
        }
    });
}

function copyFilesWithIgnoreList(sourceRootPath, destRootPath, ignorePathList) {
    var copyFilePathList = file.getDirectoryAllListing(path.join(sourceRootPath));

    ignorePathList = ignorePathList.map(function(item) {
        var reg = new RegExp(item);
        return reg;
    });

    var isIgnore = false;
    copyFilePathList.forEach(function(copyFilePath) {
        isIgnore = false;

        for (var key in ignorePathList) {//检测忽略列表
            var ignorePath = ignorePathList[key];

            if (copyFilePath.match(ignorePath)) {
                isIgnore = true;
                break;
            }
        }

        if(!isIgnore) {//不在忽略列表的路径，拷贝过去
            var copyFileRePath = path.relative(sourceRootPath, copyFilePath);
            file.copy(path.join(copyFilePath), path.join(destRootPath, copyFileRePath));
        }
    });
}


function getOptsValue(opts, typeArr) {
    for (var key in typeArr) {
        var type = typeArr[key];

        if (opts[type] && opts[type][0]) {
            return opts[type][0];
        }
    }
    return "";
}


function getPassword(opts) {
    return getOptsValue(opts, ["--password"]);
}


function compressJson(releasePath) {
    //扫描json数据
    if (param.getArgv()["opts"]["-compressjson"]) {
        var compress = require("../tools/compress_json.js");
        compress.run(releasePath, []);
    }
}


exports.run = run;
