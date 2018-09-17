/** require */
const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const { window } = new JSDOM(`<!DOCTYPE html>`);
const $ = require('jQuery')(window);
var nodemailer = require('nodemailer')
var smtpTransport = require('nodemailer-smtp-transport');
var config = require('./config');
// 控制并发数
var asy = require('async');
var fs = require('fs');
// console.log($);
// https://www.bfindex.com/Api/RestApiLite/fixtureDetailsBookers/275002

// 邮件配置
smtpTransport = nodemailer.createTransport(smtpTransport({
    service: config.email.service,
    auth: {
        user: config.email.user,
        pass: config.email.pass
    }
}));

// 计算百分比
function _calculateRate (item) {
    const total = item['home_totalamountmatched'] + item['draw_totalamountmatched'] 
                        + item['away_totalamountmatched'];
    // console.log(total);
    if (total !== 0) {
        item['home_rate'] = (item['home_totalamountmatched'] / total * 100).toFixed(2);
        item['draw_rate'] = (item['draw_totalamountmatched'] / total * 100).toFixed(2);
        item['away_rate'] = (item['away_totalamountmatched'] / total * 100).toFixed(2);
    } else {
        item['home_rate'] = 0;
        item['draw_rate'] = 0;
        item['away_rate'] = 0;
    }
}

// 关键判段
function _keyChoose (item, agoItem) {
    // 波动大于规定差异值
    return (item.home_rate >= 90 || agoItem.home_rate >= 90 || item.draw_rate >= 90 || agoItem.draw_rate >= 90 
                                || item.away_rate >= 90 || agoItem.away_rate >= 90) 
                                || (
                                    // 大于10w
                                    (item.home_totalamountmatched + item.draw_totalamountmatched + item.away_totalamountmatched >= Diff * 10000)
                                    // 盈亏 > 70
                                    && (item.home_rate * item.home_lastpricetraded - 100 >= 70 || item.away_rate * item.away_lastpricetraded - 100 >= 70)
                                );
}

// 获取亚赔
function _getAsian(id, callback) {
        // console.log(id, 22);
        $.ajax({
            type: "GET",
            url: "https://www.bfindex.com/Api/RestApiLite/fixtureDetailsBookers/" + id,
            dataType: "json",
            success: function (res) {
                callback(null, res);
            }
        });
};

/**
 * @param {String} recipient 收件人
 * @param {String} subject 发送的主题
 * @param {String} html 发送的html内容
 */
const _sendMail = function (recipient, subject, html, callback) {

    smtpTransport.sendMail({

        from: config.email.user,
        to: recipient,
        subject: subject,
        html: html

    }, function (error, response) {
        if (error) {
            console.log(error);
            return;
        }
        console.log('发送成功')
        callback && callback();
    });
}

let data = [];
let memory = {};
let _ineed = [];
// 半小时
// const Half_Hour = 0.5 * 60 * 60 * 1000;
// 规定时间
const This_Hour = 1 * 60 * 60 * 1000;
// 规定差异值
const Diff = 10;
// 规定时间Interval
const NeedIntervalTime = 10;

// 定时器1
let _needTimer = '';
let _needTimerFlag = false;
// 定时器2
let _needInterval = '';

var memoryBuffer = fs.readFileSync('./memory.json');
if (memoryBuffer.toString()) {
    memory = JSON.parse(memoryBuffer.toString());
}

// 分析
function analysis () {
    // 定时器1启动后销毁
    if (_needTimerFlag) {
        console.log('清除定时器1');
        clearTimeout(_needTimer);
        _needTimer = '';
        _needTimerFlag = false;
    }
    $.ajax({
        type: "GET",
        url: "https://www.bfindex.com/Api/RestApiLite/fixtures",
        dataType: "json",
        success: function (res) {
            data = res;
            console.log(data, '初始数据');     
            console.log(memory, '缓存数据');   
            // let timeOut = ''; 
            let isHasRecent = false;
            let needIds = [];
            let allIds = [];
            // 遍历数据  
            data.forEach((element) => {
                // console.log(element.matchdatetime);
                var matchdatetime = element.matchdatetime.replace(/-/g,"/");
                // console.log(matchdatetime);
                var match_date = new Date(matchdatetime);//将字符串转化为时间  
                // console.log(match_date + ":00");
                var now = new Date();
                var duration = match_date - now;
                // console.log(duration);
                const id = element['id'];
                allIds.push(id);
                const item = element;
                if (duration <= This_Hour && duration > 0) {
                    isHasRecent = true;
                        // 计算百分比
                    _calculateRate(item); 
                    // 纪录
                    if (memory[id] === undefined) {   
                        memory[id] = [item]; 
                    } else {
                        memory[id].push(item);
                    }
                    needIds.push(id);
                    // _ineed.push(memory[id]);
                } else if (duration <= 0) {
                   if (memory[id] !== undefined) {
                        _calculateRate(item); 
                        memory[id].push(item);
                        if (_keyChoose(item, memory[id][0])) {
                            memory[id].ago_home_rate = memory[id][0].home_rate;
                            memory[id].home_rate = item.home_rate;
                            memory[id].ago_draw_rate = memory[id][0].draw_rate;
                            memory[id].draw_rate = item.draw_rate;
                            memory[id].ago_away_rate = memory[id][0].away_rate;
                            memory[id].away_rate = item.away_rate;
                            _ineed.push(memory[id]);
                            needIds.push(id);
                        } else {
                            delete memory[id];
                        }
                   }
                } else if (duration > This_Hour && !isHasRecent && !_needTimerFlag) {
                    // 启动定时器1
                    console.log('启动定时器1');
                    _needTimerFlag = true;
                    _needTimer = setTimeout(function () {
                        analysis();
                    }, duration - 1 * 60 * 60 * 1000);
                }
            });  
            // 并发获取数据
            asy.mapLimit(needIds, 5, function (id, callback) {
                _getAsian(id, callback);
            }, function (err, result) {
                // console.log(result[0][2], 11);
                // 处理亚赔
                result.forEach(function (res, index) {
                    let obj = res[2];
                    let asianOddTx = '';
                    if (obj) {
                        // console.log(obj.historyAH)
                        let asianItem = obj.historyAH[0];
                        if (asianItem) {
                            asianOddTxt = (asianItem.homeahodd - 1).toFixed(2) + ' ' + asianItem.handicap + ' ' +
                            (asianItem.awayahodd - 1).toFixed(2) + ' ' + asianItem.lastmodified.split(' ')[1];
                        } else {
                            asianOddTxt = '暂无数据'
                        }
                    } else {
                        asianOddTxt = '暂无数据'
                    }
                    memory[needIds[index]][memory[needIds[index]].length - 1].asianOddTxt = asianOddTxt;
                });
                console.log(_ineed, '需要数据'); 
                if (_ineed.length > 0) {
                    let html = '';
                    let ids = [];
                    // 遍历需要数据
                    _ineed.forEach(needItem => {
                        ids.push(needItem[0].id);
                        html += `<div class="item"><p>${needItem[0].league} ${needItem[0].hometeam} ${needItem[0].awayteam}</p>`;
                        html += `<p>赛前1小时：${needItem.ago_home_rate}%  ${needItem.ago_draw_rate}%  ${needItem.ago_away_rate}%</p>`;
                        html += `<p>即时：${needItem.home_rate}%  ${needItem.draw_rate}%  ${needItem.away_rate}%</p></div>`;
                        html += '<div class="history">历史纪录：'
                        needItem.forEach(item => {
                            html += `<p>投注量：${item.home_rate}%  ${item.draw_rate}%  ${item.away_rate}%
                            <br> 亚赔：${item.asianOddTxt}</p>`
                        });
                        html += '</div>';
                    });
                    // 发送邮件
                    _sendMail('1010358992@qq.com','这是推荐邮件', html, function () {
                        // 清除纪录
                        _ineed.length = 0;
                        ids.forEach(id => {
                            delete memory[id]
                        });
                    });
                }
                // 创建一个可以写入的流，写入到文件 memory.json 中
                const writerStream = fs.createWriteStream('./memory.json');
                // 清除不必要的纪录
                for (let id in memory) {
                    if (allIds.indexOf(id) === -1) {
                        delete memory[id];
                    }
                }
                // 使用 utf8 编码写入数据
                writerStream.write(JSON.stringify(memory), 'UTF8');
                writerStream.end();
                console.log('now:' + new Date());
            });
            // 定时器2
            if (isHasRecent) {
                console.log('启动定时器2');
                if (_needInterval) {
                    clearInterval(_needInterval);
                    _needInterval = '';
                }
                _needInterval = setInterval(function () {
                    analysis();
                }, NeedIntervalTime * 60 * 1000);
            } else {
                console.log('清除定时器2');
                if (_needInterval) {
                    clearInterval(_needInterval);
                    _needInterval = '';
                }
                if (!_needTimerFlag) {
                    _needInterval = setInterval(function () {
                        analysis();
                    }, 3 * 60 * 60 * 1000);
                }
            }
        },
        error: function () {
            console.log('出错了');
            // 1小时后分析
            if (!_needInterval) {
                console.log('启动定时器2');
                _needInterval = setInterval(function () {
                    analysis();
                }, 1 * 60 * 60 * 1000);
            }
        }
    });
}

analysis();
// setInterval(analysis, Half_Hour);