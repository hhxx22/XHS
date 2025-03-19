const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const axios = require('axios');
const cors = require('cors');
const expressWs = require('express-ws');
const path = require('path');
const fs = require('fs');
const http = require('http');

// 创建uploads目录（如果不存在）
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// 配置文件路径
// const CONFIG_FILE_PATH = path.join(__dirname, 'config.json');

// 微信表格所在链接
DEFAULT_LINK_WECHAT = 'https://ezffb29lzx.feishu.cn/sheets/JmZHsz6grhlOUUtOa2FchSyknPg'

// note表格所在链接
note_link = 'https://ezffb29lzx.feishu.cn/sheets/Qm2MsAiJxhpSi6tfxLTcbvQ3nFd'

// 基础信息表格所在链接
kol_link = 'https://ezffb29lzx.feishu.cn/sheets/QYp2s8qSIh3vDAtbnOocfiwinmd'


// cookies表格所在链接
apptoken = 'https://ezffb29lzx.feishu.cn/base/JzfwbpB4ua8F99sJ8kYcHqPqnqe?table=tblDAKNRKLz4t6T0&view=vew81PVYqy'
// apptoken = 'https://xcnqi0wakukm.feishu.cn/base/KIp7bIZBJaUjnks3ig1cctSin4c?table=tbl2MKJ8XNdUFfCa&view=vewBXJY1uh'

// coze令牌 一个月更换一次
auth_token = ''

// 单份文件数量
const chunk_size = 1000;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const server = http.createServer(app);

// 配置CORS - 确保在所有路由之前配置
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'http://localhost:63342');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-Connection-ID');
    res.header('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// 配置WebSocket
const wsInstance = expressWs(app, server);

// 静态文件必须在WebSocket配置之后
app.use(express.static('public'));

// 添加根路由，将main.html作为默认页面
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 配置multer存储
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

// 配置文件过滤器
const fileFilter = (req, file, cb) => {
    console.log('收到文件上传请求:', file.originalname);
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
        file.mimetype === 'application/vnd.ms-excel') {
        cb(null, true);
    } else {
        console.log('文件类型不正确:', file.mimetype);
        cb(new Error('只允许上传.xlsx或.xls格式的文件！'), false);
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // 限制文件大小为10MB
    }
});

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error('发生错误:', err);
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: '文件大小不能超过10MB' });
        }
        return res.status(400).json({ error: '文件上传错误: ' + err.message });
    }
    res.status(500).json({ error: err.message });
});

// 获取auth_token
async function getAuthToken(){
    console.log('getAuthToken');
    const tokenFilePath = path.join(__dirname, 'config.json'); // 替换为你的文件路径
    // console.log('tokenFilePath', tokenFilePath);

    try {
        // 读取 token.json 文件
        const data = fs.readFileSync(tokenFilePath, 'utf-8');
        console.log('data', data);
        // 解析 JSON 数据
        const parsedData = JSON.parse(data);
        console.log('parsedData', parsedData);
        // 从 JSON 中获取 auth_token
        auth_token = parsedData.auth_token;

        // console.log('Token 已成功获取:', auth_token);
        return {
            success: true,
            message: 'Token 已成功获取',
            // auth_token: authToken
        }
    } catch (error) {
        console.error('❌ 读取或解析 token.json 文件失败:', error);
        return {
            success: false,
            message: 'Token 获取失败',
            // error: error.message
        }
    }
}

// 释放工作流
app.post('/update_token', async (req, res) => {
    const token = req.body.newToken;
    if (!token) {
        return res.status(400).json({ success: false, message: 'Token 必须提供' });
    }

    // 更新全局 auth_token
    auth_token = `Bearer ${token}`;

    // 更新 token.json 文件
    const tokenFilePath = path.join(__dirname, 'config.json');
    const newTokenData = { auth_token: auth_token };

    fs.writeFileSync(tokenFilePath, JSON.stringify(newTokenData, null, 2), 'utf-8');

    // 返回成功响应
    return res.json({
        success: true,
        message: '成功更新 token 并保存到文件',
    });
    // return res.json({ message: 'token更新成功' });
});



// 存储当前正在处理的任务数量
let activeTasksCount = 0;
let waitingTasksCount = 0;
const MAX_TASKS = 30;

// Coze API配置
const COZE_WORKFLOWS = [
    '7479139120016277544',  // 获取基本信息的工作流
    '7483126773359050762',  // 获取合作笔记的工作流
    '7480372841381576756'  // 获取微信信息的工作流
];

const COOKIES = [];

// WebSocket连接存储
const clients = new Map(); // 改用Map存储，key为connectionId，value为{ws, uploads: Set()}

// 工作流状态管理
const workflowStatus = new Array(COZE_WORKFLOWS.length).fill(false);
let lastWorkflowIndex = -1;

// 获取下一个可用的工作流（使用Promise实现等待机制）
async function getNextAvailableWorkflow() {
    while (true) {
        // 检查是否有可用的工作流
        const startIndex = (lastWorkflowIndex + 1) % COZE_WORKFLOWS.length;
        for (let i = 0; i < COZE_WORKFLOWS.length; i++) {
            const index = (startIndex + i) % COZE_WORKFLOWS.length;
            if (!workflowStatus[index]) {
                lastWorkflowIndex = index;
                workflowStatus[index] = true;
                return index;
            }
        }
        // 如果没有可用的工作流，等待一段时间后重试
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}
// 函数实现，参数单位 毫秒 ；
function wait(ms) {
    return new Promise(resolve =>setTimeout(() =>resolve(), ms));
};

// 释放工作流
function releaseWorkflow(index) {
    if (index >= 0 && index < workflowStatus.length) {
        workflowStatus[index] = false;
        console.log(`释放工作流 ${index}`);
    }
}

// WebSocket路由必须在静态文件路由之后  获取基本信息的
app.ws('/status', (ws, req) => {
    const connectionId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    console.log('新的WebSocket连接已建立, ID:', connectionId);
    
    // 发送初始连接成功消息
    try {
        ws.send(JSON.stringify({
            type: 'connection',
            message: 'WebSocket连接成功',
            connectionId: connectionId
        }));
    } catch (error) {
        console.error('发送WebSocket消息失败:', error);
    }

    // 将新连接添加到clients Map中
    clients.set(connectionId, {
        ws,
        uploads: new Set()
    });

    // 处理WebSocket消息
    ws.on('message', async (msg) => {
        try {
            const data = JSON.parse(msg);
            if (data.type === 'pong') {
                console.log('收到客户端心跳响应');
            } else if (data.type === 'requestStatus') {
                // 处理状态请求
                if (data.connectionId) {
                    const userTasks = getTaskState(data.connectionId);
                    if (userTasks.size > 0) {
                        // 发送所有进行中的任务状态
                        for (const [uploadId, task] of userTasks) {
                            broadcastStatus({
                                type: task.status,
                                uploadId: uploadId,
                                fileName: task.fileName,
                                message: task.message,
                                current: task.current,
                                total: task.total
                            }, data.connectionId);
                        }
                    }
                }
            } else if (data.type === 'reconnect') {
                // 处理重连请求
                if (data.oldConnectionId) {
                    const oldTasks = getTaskState(data.oldConnectionId);
                    if (oldTasks.size > 0) {
                        // 将旧连接ID的任务转移到新连接ID
                        taskStates.set(connectionId, oldTasks);
                        taskStates.delete(data.oldConnectionId);
                        // 发送所有任务状态
                        for (const [uploadId, task] of oldTasks) {
                            broadcastStatus({
                                type: task.status,
                                uploadId: uploadId,
                                fileName: task.fileName,
                                message: task.message,
                                current: task.current,
                                total: task.total
                            }, connectionId);
                        }
                    }
                }
            } else if (data.type === 'updateCookies') {
                const result = await fetchCookiesList();
                ws.send(JSON.stringify({
                    type: 'cookiesUpdate',
                    ...result
                }));
            }
        } catch (error) {
            console.error('处理WebSocket消息错误:', error);
        }
    });

    // 心跳检测
    const pingInterval = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
            try {
                ws.send(JSON.stringify({ type: 'ping' }));
            } catch (error) {
                console.error('心跳检测失败:', error);
                clearInterval(pingInterval);
                clients.delete(connectionId);
            }
        } else {
            clearInterval(pingInterval);
            clients.delete(connectionId);
        }
    }, 30000);

    ws.on('close', () => {
        console.log('WebSocket连接已关闭, ID:', connectionId);
        clients.delete(connectionId);
        clearInterval(pingInterval);
    });

    ws.on('error', (error) => {
        console.error('WebSocket错误:', error);
        clients.delete(connectionId);
        clearInterval(pingInterval);
    });
});

// 获取合作笔记信息的
app.ws('/status_getnote', (ws, req) => {
    const connectionId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    console.log('新的WebSocket连接已建立, ID:', connectionId);
    
    // 发送初始连接成功消息
    try {
        ws.send(JSON.stringify({
            type: 'connection',
            message: 'WebSocket连接成功',
            connectionId: connectionId
        }));
    } catch (error) {
        console.error('发送WebSocket消息失败:', error);
    }

    // 将新连接添加到clients Map中
    clients.set(connectionId, {
        ws,
        uploads: new Set()
    });

    // 处理WebSocket消息
    ws.on('message', async (msg) => {
        try {
            const data = JSON.parse(msg);
            if (data.type === 'pong') {
                console.log('收到客户端心跳响应');
            } else if (data.type === 'requestStatus') {
                // 处理状态请求
                if (data.connectionId) {
                    const userTasks = getTaskState(data.connectionId);
                    if (userTasks.size > 0) {
                        // 发送所有进行中的任务状态
                        for (const [uploadId, task] of userTasks) {
                            broadcastStatus({
                                type: task.status,
                                uploadId: uploadId,
                                fileName: task.fileName,
                                message: task.message,
                                current: task.current,
                                total: task.total
                            }, data.connectionId);
                        }
                    }
                }
            } else if (data.type === 'reconnect') {
                // 处理重连请求
                if (data.oldConnectionId) {
                    const oldTasks = getTaskState(data.oldConnectionId);
                    if (oldTasks.size > 0) {
                        // 将旧连接ID的任务转移到新连接ID
                        taskStates.set(connectionId, oldTasks);
                        taskStates.delete(data.oldConnectionId);
                        // 发送所有任务状态
                        for (const [uploadId, task] of oldTasks) {
                            broadcastStatus({
                                type: task.status,
                                uploadId: uploadId,
                                fileName: task.fileName,
                                message: task.message,
                                current: task.current,
                                total: task.total
                            }, connectionId);
                        }
                    }
                }
            } else if (data.type === 'updateCookies') {
                const result = await fetchCookiesList();
                ws.send(JSON.stringify({
                    type: 'cookiesUpdate',
                    ...result
                }));
            }
        } catch (error) {
            console.error('处理WebSocket消息错误:', error);
        }
    });

    // 心跳检测
    const pingInterval = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
            try {
                ws.send(JSON.stringify({ type: 'ping' }));
            } catch (error) {
                console.error('心跳检测失败:', error);
                clearInterval(pingInterval);
                clients.delete(connectionId);
            }
        } else {
            clearInterval(pingInterval);
            clients.delete(connectionId);
        }
    }, 30000);

    ws.on('close', () => {
        console.log('WebSocket连接已关闭, ID:', connectionId);
        clients.delete(connectionId);
        clearInterval(pingInterval);
    });

    ws.on('error', (error) => {
        console.error('WebSocket错误:', error);
        clients.delete(connectionId);
        clearInterval(pingInterval);
    });
});

// 修改广播状态更新函数，添加connectionId参数
function broadcastStatus(message, connectionId) {
    const messageStr = JSON.stringify(message);
    console.log(`广播消息到连接 ${connectionId}:`, messageStr);
    
    // 保存任务状态
    if (message.type !== 'ping' && message.uploadId) {
        saveTaskState(connectionId, {
            ...message,
            fileName: message.fileName || '未知文件'
        });
    }

    // 如果任务完成或出错，清理状态
    if ((message.type === 'complete' || message.type === 'error') && message.uploadId) {
        clearTaskState(connectionId, message.uploadId);
    }
    
    const client = clients.get(connectionId);
    if (client && client.ws.readyState === 1) {
        try {
            client.ws.send(messageStr);
        } catch (error) {
            console.error('发送消息到客户端失败:', error);
            clients.delete(connectionId);
        }
    }
}

// 在全局变量区域添加任务状态管理
const taskStates = new Map(); // 存储所有任务的状态

// 任务状态管理函数
function saveTaskState(connectionId, state) {
    if (!taskStates.has(connectionId)) {
        taskStates.set(connectionId, new Map());
    }
    const userTasks = taskStates.get(connectionId);
    userTasks.set(state.uploadId, {
        fileName: state.fileName,
        total: state.total,
        current: state.current,
        message: state.message,
        status: state.type,
        timestamp: Date.now()
    });
}

function getTaskState(connectionId) {
    return taskStates.get(connectionId) || new Map();
}

function clearTaskState(connectionId, uploadId) {
    const userTasks = taskStates.get(connectionId);
    if (userTasks) {
        userTasks.delete(uploadId);
        if (userTasks.size === 0) {
            taskStates.delete(connectionId);
        }
    }
}

// 定期清理过期的任务状态（比如1小时前的任务）
setInterval(() => {
    const oneHourAgo = Date.now() - 3600000;
    for (const [connectionId, userTasks] of taskStates) {
        for (const [uploadId, task] of userTasks) {
            if (task.timestamp < oneHourAgo) {
                clearTaskState(connectionId, uploadId);
            }
        }
    }
}, 300000); // 每5分钟清理一次

// 添加延迟函数
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// 添加重试函数
async function retryRequest(fn, retries = 3, backoff = 8000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (error.response && error.response.status === 429) {
                console.log(`请求被限流，等待 ${backoff}ms 后重试...`);
                await delay(backoff);
                // 指数退避，每次重试等待时间翻倍
                backoff *= 2;
                continue;
            }
            throw error;
        }
    }
    throw new Error('超过最大重试次数');
}


// 在服务器端添加 CookieManager 类
const CookieManager = {
    cookiesMap: new Map(), // 存储 {账号名: {cookies, inUse}}
    waitingQueue: [], // 等待队列

    // 初始化或更新cookies列表
    updateCookiesList(cookiesList) {
        // 保留现有的使用状态
        const currentStatus = new Map();
        this.cookiesMap.forEach((value, name) => {
            currentStatus.set(name, value.inUse);
        });
        
        // 清空并重新设置
        this.cookiesMap.clear();
        
        cookiesList.forEach(item => {
            this.cookiesMap.set(item.name, {
                cookies: item.cookies,
                id:item.id,
                inUse: currentStatus.has(item.name) ? currentStatus.get(item.name) : false
            });
        });
        
        console.log('Cookies列表已更新，共', this.cookiesMap.size, '个账号');
        this.logStatus();
    },

    // 获取一个可用的cookie
    async getAvailableCookie() {
        // 查找未使用的cookie
        for (const [name, data] of this.cookiesMap) {
            if (!data.inUse) {
                data.inUse = true;
                console.log(`分配账号 ${name} 的cookies`);
                this.logStatus();
                return { name, cookies: data.cookies,id:data.id };
            }
        }

        // 如果没有可用的cookie，等待释放
        console.log('当前没有可用的cookies，等待中...');
        return new Promise((resolve) => {
            this.waitingQueue.push(resolve);
        });
    },

    // 释放cookie
    releaseCookie(name) {
        if (this.cookiesMap.has(name)) {
            this.cookiesMap.get(name).inUse = false;
            console.log(`释放账号 ${name} 的cookies`);
            
            // 处理等待队列
            if (this.waitingQueue.length > 0) {
                const resolve = this.waitingQueue.shift();
                const availableCookie = this.getFirstAvailableCookie();
                if (availableCookie) {
                    resolve(availableCookie);
                }
            }
            
            this.logStatus();
        }
    },

    // 获取第一个可用的cookie（内部使用）
    getFirstAvailableCookie() {
        for (const [name, data] of this.cookiesMap) {
            if (!data.inUse) {
                data.inUse = true;
                return { name, cookies: data.cookies,id:data.id };
            }
        }
        return null;
    },

    // 打印当前状态
    logStatus() {
        console.log('当前cookies使用状态:');
        this.cookiesMap.forEach((data, name) => {
            console.log(`${name}: ${data.inUse ? '使用中' : '空闲'}`);
        });
    }
};

// 修改 fetchCookiesList 函数
async function fetchCookiesList() {
    try {
        let jsonData = {
            workflow_id: '7482970039504617498',
            parameters: {
                spreadsheet_token: apptoken
            },
            bot_id: '7481335010365358115',
        };

        const response = await retryRequest(async () => {
            try {
                await delay(1000);
                return await axios.post('https://api.coze.cn/v1/workflow/run', jsonData, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': auth_token,
                        'Accept': 'application/json'
                    },
                    validateStatus: null,
                    timeout: 120000
                });
            } catch (error) {
                console.error('获取cookies失败:', error);
                throw error;
            }
        });
        
        if (response.data.msg === 'access token invalid'){
            return {
                success: false,
                message: 'token已过期',
                error: 'token已过期'
            };
        }
        // const response = {
        //     data:{
        //     code: 0,
        //     cost: '0',
        //     data: '{"output":[{"cookies":"abRequestId=47b3ee86-3d47-542c-a705-f7177b3bc980; a1=192184ffd8f1tks3vl06lf3f3x3bjh2je6zq146rm50000160527; webId=2f0575d9c0dd3f031b333b71080ac4a6; gid=yjJyY288JDd8yjJyY4iifK4KYiy9TMqh18K1uF6iqiqCqA28DVxJVy888yK82JW8JDSj4yYW; x-user-id-creator.xiaohongshu.com=5f216259000000000100adec; customerClientId=885558463823139; access-token-creator.xiaohongshu.com=customer.creator.AT-68c517473488694576985236pegbh0cuemlcwwja; galaxy_creator_session_id=7x4Zu7xEpVmIkWjemgJel4esXonwcBntiyHU; galaxy.creator.beaker.session.id=1740057183128000051334; webBuild=4.59.0; x-user-id-pgy.xiaohongshu.com=67c27b0d04f0000000000001; unread={%22ub%22:%2267af8214000000002a001e7a%22%2C%22ue%22:%2267aec04000000000180189d7%22%2C%22uc%22:37}; loadts=1741659500774; web_session=0400698e55211156fdba15d5fa354b3b939ed5; xsecappid=ratlin; websectiga=82e85efc5500b609ac1166aaf086ff8aa4261153a448ef0be5b17417e4512f28; sec_poison_id=da6467f4-7705-4f10-91e7-721269943bb7; customer-sso-sid=68c517483107750573469533usrcrydpklnuz7kl; solar.beaker.session.id=AT-68c517483107750482540507dvlsmmepoermetam; access-token-pgy.xiaohongshu.com=customer.pgy.AT-68c517483107750482540507dvlsmmepoermetam; access-token-pgy.beta.xiaohongshu.com=customer.pgy.AT-68c517483107750482540507dvlsmmepoermetam; acw_tc=0a4ad2fc17422968076304916e5a06d88e7ec9bf375963c45ea3805ee37399","id":1,"name":"账号1"}]}',
        //     debug_url: 'https://www.coze.cn/work_flow?execute_id=7483120644269424649&space_id=7477500975146827816&workflow_id=7482970039504617498&execute_mode=2',
        //     msg: 'Success',
        //     token: 0
        //   }
        // }
        // console.log(response.data)
        if (response.data && response.data.data) {
            const cookiesList = JSON.parse(response.data.data).output;
            if (Array.isArray(cookiesList) && cookiesList.length > 0) {
                // 更新CookieManager
                CookieManager.updateCookiesList(cookiesList);
                
                console.log('成功更新Cookies列表，共获取到', cookiesList.length, '个账号');
                return {
                    success: true,
                    message: `成功更新Cookies列表，共获取到${cookiesList.length}个账号`,
                    count: cookiesList.length
                };
            } else {
                throw new Error('获取到的cookies列表为空');
            }
        } else {
            throw new Error('API响应数据格式错误');
        }
    } catch (error) {
        console.error('更新Cookies失败:', error);
        return {
            success: false,
            message: '更新Cookies失败: ' + error.message,
            error: error.message
        };
    }
}

// 修改处理数据块的函数 //基本信息
async function processChunk(chunk, index, chunks, uploadId, connectionId, additionalLink) {
    
    try {
        waitingTasksCount--;
        activeTasksCount++;
        let accountName;
    const sheetName = `Sheet${index + 1}`;
    // console.log(sheetName);
    // 数据预处理和验证
    const values = chunk.map(obj => {
        const value = Object.values(obj)[0];
        return String(value).trim();
    }).filter(value => value.length > 0);

    if (values.length === 0) {
        throw new Error('没有有效的数据需要处理');
    }
        // 获取可用的cookie
        const cookieData = await CookieManager.getAvailableCookie();
        accountName = cookieData.name;
        // console.log(cookieData)
        
        console.log(`使用账号 ${accountName} 处理第 ${index + 1} 块数据`);
        
        
        const kolLink = additionalLink || kol_link;
        // 构建请求数据
        let jsonData = {
            workflow_id: COZE_WORKFLOWS[0], // 使用同一个workflow
            parameters: {
                chunk: JSON.stringify(values),
                cookie_str: cookieData.cookies,
                sheet_name: sheetName,
                app_token:apptoken,
                kol_link:kolLink,
                id:cookieData.id,

            },
            bot_id: '7481335010365358115',
        };
        // console.log(jsonData.parameters)

        // 使用重试机制发送请求
        const response = await retryRequest(async () => {
            try {
                await delay(1000);
                return await axios.post('https://api.coze.cn/v1/workflow/run', jsonData, {
                    headers: {
                        // 'Cookie': cookieData.cookies,
                        'Content-Type': 'application/json',
                        'Authorization': auth_token,
                        'Accept': 'application/json'
                    },
                    validateStatus: null,
                    timeout: 120000
                });
            } catch (error) {
                console.error(`处理Sheet${index + 1}时出错:`, error);
                throw error;
            }
        });
        // console.log(response.data)
        if (response.data.msg === 'access token invalid'){
            CookieManager.releaseCookie(accountName);
            broadcastStatus({
                type: 'progress',
                message: `token已过期`,
                current: index + 1,
                total: chunks.length,
                uploadId: uploadId,
                chunkIndex: index + 1,
                totalChunks: chunks.length,
                status: 'error',
                sheetName: sheetName,
                processResult: {
                    success: false,
                    successCount: 0,
                    totalCount: 0,
                    message: 'token已过期'
                }
            }, connectionId);
            return {
                success: false,
                message: 'token已过期',
                error: 'token已过期'
            };
        }
        
        // 处理响应
        if (response.data && response.data.data) {
            const data = JSON.parse(response.data.data).output;
            if (data.length === 0){
                CookieManager.releaseCookie(accountName);
            broadcastStatus({
                type: 'progress',
                message: `获取的数据为空，检查cookies是否有效`,
                current: index + 1,
                total: chunks.length,
                uploadId: uploadId,
                chunkIndex: index + 1,
                totalChunks: chunks.length,
                status: 'error',
                sheetName: sheetName,
                processResult: {
                    success: false,
                    successCount: 0,
                    totalCount: 0,
                    message: '获取的数据为空，检查cookies是否有效'
                }
            }, connectionId);
            return {
                success: false,
                message: '获取的数据为空，检查cookies是否有效',
                error: '获取的数据为空，检查cookies是否有效'
            };

            }
            
            const successCount = data.filter(item => item === "success").length;
            const failureCount = data.filter(item => item !== "success").length;

            if (failureCount === 0) {
                // 全部成功的情况
                broadcastStatus({
                    type: 'progress',
                    message: `完成处理第 ${index + 1}/${chunks.length} 块数据 (${sheetName})`,
                    current: index + 1,
                    total: chunks.length,
                    uploadId: uploadId,
                    chunkIndex: index + 1,
                    totalChunks: chunks.length,
                    status: 'completed',
                    sheetName: sheetName,
                    processResult: {
                        success: true,
                        successCount: successCount,
                        totalCount: data.length,
                        message: `成功处理 ${successCount} 条数据`
                    }
                }, connectionId);
                console.log('该释放账号',accountName);
                CookieManager.releaseCookie(accountName);
                return { 
                    success: true, 
                    data: response.data.data,
                    sheetName: sheetName,
                    processResult: {
                        success: true,
                        successCount: successCount,
                        totalCount: data.length
                    }
                };
            } else {
                // 存在错误的情况
                const errorItems = data.map((result, idx) => {
                    if (result !== "success") {
                        return {
                            index: idx,
                            error: result // 错误信息
                        };
                    }
                    return null;
                }).filter(item => item !== null);

                // 返回错误信息给前端
                broadcastStatus({
                    type: 'progress',
                    message: `数据块 ${index + 1} 处理完成，但存在错误`,
                    current: index + 1,
                    total: chunks.length,
                    uploadId: uploadId,
                    chunkIndex: index + 1,
                    totalChunks: chunks.length,
                    status: 'error',
                    sheetName: sheetName,
                    processResult: {
                        success: false,
                        successCount: successCount,
                        failureCount: failureCount,
                        totalCount: data.length,
                        message: `处理完成：${successCount}条成功，${failureCount}条失败`,
                        errorItems: errorItems
                    }
                }, connectionId);
                console.log('该释放账号',accountName);
                CookieManager.releaseCookie(accountName);
                return {
                    success: false,
                    error: `${failureCount}条数据处理失败`,
                    sheetName: sheetName,
                    processResult: {
                        success: false,
                        successCount: successCount,
                        failureCount: failureCount,
                        totalCount: data.length,
                        errorItems: errorItems
                    }
                };
            }
            
        } else {
            throw new Error(`处理${sheetName}时返回的数据无效`);
        }
    } catch (error) {
        console.error(`处理${sheetName}时出错:`, error);
        
        broadcastStatus({
            type: 'progress',
            message: `Sheet${index + 1} 处理失败: ${error.message},请检查cookies是否有效`,
            current: index + 1,
            total: chunks.length,
            uploadId: uploadId,
            chunkIndex: index + 1,
            totalChunks: chunks.length,
            status: 'error',
            errorDetails: [{ index: 0, value: error.message }],
            sheetName: `Sheet${index + 1}`
        }, connectionId);

        return {
            success: false,
            error: error.message,
            chunkIndex: index,
            sheetName: `Sheet${index + 1}`
        };
    } finally {
        console.log('文件全部结束')
        // console.log('ni该释放账号',accountName);
        // if (accountName) {
        //     CookieManager.releaseCookie(accountName);
        // }
        // activeTasksCount--;
    }
}

// 基本信息
app.post('/upload', (req, res, next) => {
    const connectionId = req.headers['x-connection-id'];
    if (!connectionId || !clients.has(connectionId)) {
        return res.status(400).json({ error: '无效的连接ID' });
    }

    console.log('接收到上传请求, 连接ID:', connectionId);
    upload.single('file')(req, res, async (err) => {
        if (err) {
            console.error('文件上传错误:', err);
            return res.status(400).json({ error: err.message });
        }

        if (!req.file) {
            console.error('没有接收到文件');
            return res.status(400).json({ error: '没有接收到文件' });
        }

        console.log('文件上传成功:', req.file.originalname);

        // 获取额外链接参数
        const additionalLink = req.body.additionalLink;
        // console.log('获取到的额外链接:', additionalLink);
        // console.log('请求体内容:', req.body);
        // console.log('文件上传成功:', req.file.originalname);

        try {
            // console.log('开始读取Excel文件');
            const workbook = XLSX.readFile(req.file.path);
            const sheetNames = workbook.SheetNames;
            const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetNames[0]]);
            // console.log(`成功读取Excel文件，共${data.length}条数据`);

            // 将数据分成chunk_size条一组
            const chunks = [];
            for (let i = 0; i < data.length; i += chunk_size) {
                chunks.push(data.slice(i, i + chunk_size));
            }
            // console.log(`数据已分割成${chunks.length}个块`);

            // 检查任务数量限制（包括正在处理和等待的任务）
            const totalTasks = activeTasksCount + waitingTasksCount + chunks.length;
            if (totalTasks > MAX_TASKS) {
                // console.log('当前任务数量将超过限制:', totalTasks);
                // 删除上传的文件
                fs.unlinkSync(req.file.path);
                return res.status(429).json({ 
                    error: `系统正在处理${activeTasksCount}个任务，等待处理${waitingTasksCount}个任务，本次上传将产生${chunks.length}个任务，总计${totalTasks}个任务超过系统限制${MAX_TASKS}个，请稍后再试` 
                });
            }

            // 更新等待任务数量
            waitingTasksCount += chunks.length;
            
            // 将此上传任务添加到对应连接的uploads集合中
            const client = clients.get(connectionId);
            const uploadId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            client.uploads.add(uploadId);

            broadcastStatus({ 
                type: 'start', 
                message: `开始处理文件 ${req.file.originalname}，共${chunks.length}个数据块`, 
                totalChunks: chunks.length,
                uploadId: uploadId,
                fileName: req.file.originalname  // 添加文件名
            }, connectionId);

            // 并行处理所有分块
            const promises = chunks.map((chunk, index) => 
                processChunk(chunk, index, chunks, uploadId, connectionId, additionalLink).catch(error => ({
                    success: false,
                    error: error.message,
                    chunkIndex: index
                }))
            );
            
            // 等待所有任务完成
            Promise.all(promises)
                .then((results) => {
                    // 检查所有结果
                    const failedChunks = results.filter(result => !result.success);
                    
                    if (failedChunks.length === 0) {
                        // 所有块都处理成功
                        broadcastStatus({ 
                            type: 'complete', 
                            message: '文件处理完成',
                            uploadId: uploadId
                        }, connectionId);
                    } else {
                        // 有块处理失败，但不影响其他块的显示
                        broadcastStatus({ 
                            type: 'partial_complete', 
                            message: `文件处理完成，但有 ${failedChunks.length} 个数据块失败`,
                            uploadId: uploadId,
                            failedChunks: failedChunks
                        }, connectionId);
                    }
                    client.uploads.delete(uploadId);
                })
                .catch(error => {
                    // 处理意外的错误
                    broadcastStatus({ 
                        type: 'error', 
                        message: '处理过程中发生系统错误: ' + error.message,
                        uploadId: uploadId
                    }, connectionId);
                    client.uploads.delete(uploadId);
                });

            res.json({ message: '文件上传成功，开始处理' });
        } catch (error) {
            console.error('处理文件时发生错误:', error);
            activeTasksCount = Math.max(0, activeTasksCount - 1);
            res.status(500).json({ error: '处理文件时发生错误: ' + error.message });
        } finally {
            // 清理上传的文件
            if (fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
                // console.log('已清理上传的文件:', req.file.path);
            }
        }
    });
});

// 合作笔记
async function processChunkNote(chunk, index, chunks, uploadId, connectionId, additionalLink) {
    
    try {
        waitingTasksCount--;
        activeTasksCount++;
        let accountName;
        const sheetName = `Sheet${index + 1}`;
        // console.log(sheetName);
        // 数据预处理和验证
        const values = chunk.map(obj => {
            const value = Object.values(obj)[0];
            return String(value).trim();
        }).filter(value => value.length > 0);

        if (values.length === 0) {
            throw new Error('没有有效的数据需要处理');
        }
        // 获取可用的cookie
        const cookieData = await CookieManager.getAvailableCookie();
        accountName = cookieData.name;
        // console.log(cookieData)
        
        console.log(`使用账号 ${accountName} 处理第 ${index + 1} 块数据`);
        
        
        const noteLink = additionalLink || note_link;
        // 构建请求数据
        let jsonData = {
            workflow_id: COZE_WORKFLOWS[1], // 使用同一个workflow
            parameters: {
                chunk: JSON.stringify(values),
                cookie_str: cookieData.cookies,
                sheet_name: sheetName,
                app_token:apptoken,
                note_link:noteLink,
                id:cookieData.id,

            },
            bot_id: '7481335010365358115',
        };
        // console.log("使用合作笔记:",jsonData.parameters)

        // 使用重试机制发送请求
        const response = await retryRequest(async () => {
            try {
                await delay(1000);
                return await axios.post('https://api.coze.cn/v1/workflow/run', jsonData, {
                    headers: {
                        // 'Cookie': cookieData.cookies,
                        'Content-Type': 'application/json',
                        'Authorization': auth_token,
                        'Accept': 'application/json'
                    },
                    validateStatus: null,
                    timeout: 120000
                });
            } catch (error) {
                console.error(`处理Sheet${index + 1}时出错:`, error);
                throw error;
            }
        });
        console.log(response.data)
        if (response.data.msg === 'access token invalid'){
            CookieManager.releaseCookie(accountName);
            broadcastStatus({
                type: 'progress',
                message: `token已过期`,
                current: index + 1,
                total: chunks.length,
                uploadId: uploadId,
                chunkIndex: index + 1,
                totalChunks: chunks.length,
                status: 'error',
                sheetName: sheetName,
                processResult: {
                    success: false,
                    successCount: 0,
                    totalCount: 0,
                    message: 'token已过期'
                }
            }, connectionId);
            return {
                success: false,
                message: 'token已过期',
                error: 'token已过期'
            };
        }
        
        // 处理响应
        if (response.data && response.data.data) {
            const data = JSON.parse(response.data.data).output;
            if (data.length === 0){
                CookieManager.releaseCookie(accountName);
            broadcastStatus({
                type: 'progress',
                message: `获取的数据为空，检查cookies是否有效`,
                current: index + 1,
                total: chunks.length,
                uploadId: uploadId,
                chunkIndex: index + 1,
                totalChunks: chunks.length,
                status: 'error',
                sheetName: sheetName,
                processResult: {
                    success: false,
                    successCount: 0,
                    totalCount: 0,
                    message: '获取的数据为空，检查cookies是否有效'
                }
            }, connectionId);
            return {
                success: false,
                message: '获取的数据为空，检查cookies是否有效',
                error: '获取的数据为空，检查cookies是否有效'
            };

            }
            const successCount = data.filter(item => item === "success").length;
            const failureCount = data.filter(item => item !== "success").length;

            if (failureCount === 0) {
                // 全部成功的情况
                broadcastStatus({
                    type: 'progress',
                    message: `完成处理第 ${index + 1}/${chunks.length} 块数据 (${sheetName})`,
                    current: index + 1,
                    total: chunks.length,
                    uploadId: uploadId,
                    chunkIndex: index + 1,
                    totalChunks: chunks.length,
                    status: 'completed',
                    sheetName: sheetName,
                    processResult: {
                        success: true,
                        successCount: successCount,
                        totalCount: data.length,
                        message: `成功处理 ${successCount} 条数据`
                    }
                }, connectionId);
                // console.log('该释放账号',accountName);
                CookieManager.releaseCookie(accountName);
                return { 
                    success: true, 
                    data: response.data.data,
                    sheetName: sheetName,
                    processResult: {
                        success: true,
                        successCount: successCount,
                        totalCount: data.length
                    }
                };
            } else {
                // 存在错误的情况
                const errorItems = data.map((result, idx) => {
                    if (result !== "success") {
                        return {
                            index: idx,
                            error: result // 错误信息
                        };
                    }
                    return null;
                }).filter(item => item !== null);

                // 返回错误信息给前端
                broadcastStatus({
                    type: 'progress',
                    message: `数据块 ${index + 1} 处理完成，但存在错误`,
                    current: index + 1,
                    total: chunks.length,
                    uploadId: uploadId,
                    chunkIndex: index + 1,
                    totalChunks: chunks.length,
                    status: 'error',
                    sheetName: sheetName,
                    processResult: {
                        success: false,
                        successCount: successCount,
                        failureCount: failureCount,
                        totalCount: data.length,
                        message: `处理完成：${successCount}条成功，${failureCount}条失败`,
                        errorItems: errorItems
                    }
                }, connectionId);
                // console.log('该释放账号', accountName);
                CookieManager.releaseCookie(accountName);
                return {
                    success: false,
                    error: `${failureCount}条数据处理失败`,
                    sheetName: sheetName,
                    processResult: {
                        success: false,
                        successCount: successCount,
                        failureCount: failureCount,
                        totalCount: data.length,
                        errorItems: errorItems
                    }
                };
            }
            
        } else {
            throw new Error(`处理${sheetName}时返回的数据无效`);
        }
    } catch (error) {
        console.error(`处理${sheetName}时出错:`, error,"请检查cookies是否有效");
        
        broadcastStatus({
            type: 'progress',
            message: `Sheet${index + 1} 处理失败: ${error.message},请检查cookies是否有效`,
            current: index + 1,
            total: chunks.length,
            uploadId: uploadId,
            chunkIndex: index + 1,
            totalChunks: chunks.length,
            status: 'error',
            errorDetails: [{ index: 0, value: error.message }],
            sheetName: `Sheet${index + 1}`
        }, connectionId);

        return {
            success: false,
            error: error.message,
            chunkIndex: index,
            sheetName: `Sheet${index + 1}`
        };
    } finally {
        console.log('文件全部结束');
        // activeTasksCount--;
    }
}

// 合作笔记
app.post('/upload_note', (req, res) => {
    const connectionId = req.headers['x-connection-id'];
    if (!connectionId || !clients.has(connectionId)) {
        return res.status(400).json({ error: '无效的连接ID' });
    }
    
    console.log('接收到合作笔记上传请求, 连接ID:', connectionId);
    
    // 使用单一的 multer 中间件处理文件上传
    upload.single('file')(req, res, async (err) => {
        if (err) {
            console.error('文件上传错误:', err);
            return res.status(400).json({ error: err.message });
        }

        if (!req.file) {
            console.error('没有接收到文件');
            return res.status(400).json({ error: '没有接收到文件' });
        }

        // 获取额外链接参数
        const additionalLink = req.body.additionalLink;
        // console.log('获取到的额外链接:', additionalLink);
        // console.log('请求体内容:', req.body);
        // console.log('文件上传成功:', req.file.originalname);

        try {
            // console.log('开始读取Excel文件');
            const workbook = XLSX.readFile(req.file.path);
            const sheetNames = workbook.SheetNames;
            const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetNames[0]]);
            // console.log(`成功读取Excel文件，共${data.length}条数据`);

            // 将数据分成1000条一组
            const chunks = [];
            for (let i = 0; i < data.length; i += chunk_size) {
                chunks.push(data.slice(i, i + chunk_size));
            }
            // console.log(`数据已分割成${chunks.length}个块`);

            // 检查任务数量限制（包括正在处理和等待的任务）
            const totalTasks = activeTasksCount + waitingTasksCount + chunks.length;
            if (totalTasks > MAX_TASKS) {
                console.log('当前任务数量将超过限制:', totalTasks);
                // 删除上传的文件
                fs.unlinkSync(req.file.path);
                return res.status(429).json({ 
                    error: `系统正在处理${activeTasksCount}个任务，等待处理${waitingTasksCount}个任务，本次上传将产生${chunks.length}个任务，总计${totalTasks}个任务超过系统限制${MAX_TASKS}个，请稍后再试` 
                });
            }

            // 更新等待任务数量
            waitingTasksCount += chunks.length;
            
            // 将此上传任务添加到对应连接的uploads集合中
            const client = clients.get(connectionId);
            const uploadId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            client.uploads.add(uploadId);

            broadcastStatus({ 
                type: 'start', 
                message: `开始处理文件 ${req.file.originalname}，共${chunks.length}个数据块`, 
                totalChunks: chunks.length,
                uploadId: uploadId,
                fileName: req.file.originalname  // 添加文件名
            }, connectionId);

            // 并行处理所有分块
            const promises = chunks.map((chunk, index) => 
                processChunkNote(chunk, index, chunks, uploadId, connectionId, additionalLink).catch(error => ({
                    success: false,
                    error: error.message,
                    chunkIndex: index
                }))
            );
            
            // 等待所有任务完成
            Promise.all(promises)
                .then((results) => {
                    // 检查所有结果
                    const failedChunks = results.filter(result => !result.success);
                    
                    if (failedChunks.length === 0) {
                        // 所有块都处理成功
                        broadcastStatus({ 
                            type: 'complete', 
                            message: '文件处理完成',
                            uploadId: uploadId
                        }, connectionId);
                    } else {
                        // 有块处理失败，但不影响其他块的显示
                        broadcastStatus({ 
                            type: 'partial_complete', 
                            message: `文件处理完成，但有 ${failedChunks.length} 个数据块失败`,
                            uploadId: uploadId,
                            failedChunks: failedChunks
                        }, connectionId);
                    }
                    client.uploads.delete(uploadId);
                })
                .catch(error => {
                    // 处理意外的错误
                    broadcastStatus({ 
                        type: 'error', 
                        message: '处理过程中发生系统错误: ' + error.message,
                        uploadId: uploadId
                    }, connectionId);
                    client.uploads.delete(uploadId);
                });

            res.json({ message: '文件上传成功，开始处理' });
        } catch (error) {
            console.error('处理文件时发生错误:', error);
            activeTasksCount = Math.max(0, activeTasksCount - 1);
            res.status(500).json({ error: '处理文件时发生错误: ' + error.message });
        } finally {
            // 清理上传的文件
            if (fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
                console.log('已清理上传的文件:', req.file.path);
            }
        }
    });
});

// 处理来自 wechat.html 的请求
app.post('/wechat', async (req, res) => {
    // console.log(req.body)
    const { id, fromPage, link } = req.body;
    // 使用用户输入的链接或默认链接
    const finalLink = link || DEFAULT_LINK_WECHAT;
    const FromPage = fromPage || 1;
    console.log(finalLink);

    try {
        // 调用 Coze API
        // 构建请求数据
        let jsonData = {
            workflow_id: COZE_WORKFLOWS[2], // 使用同一个workflow
            parameters: {
                pagesize: 10,
                app_token: apptoken,
                spreadsheet_token: finalLink,
                id: Number(id),
                frompage: Number(FromPage)
            },
            bot_id: '7483145118535712777',
        };
        // console.log(jsonData.parameters);

        // 使用重试机制发送请求
        const response = await retryRequest(async () => {
            try {
                await delay(1000);
                return await axios.post('https://api.coze.cn/v1/workflow/run', jsonData, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': auth_token,
                        'Accept': 'application/json'
                    },
                    validateStatus: null,
                    timeout: 120000
                });
            } catch (error) {
                console.error(`处理出错:`, error);
                throw error;
            }
        });
        // console.log(response.data)
        if (response.data.msg === 'access token invalid'){
            return res.status(500).json({ error: 'token过期' });
        }
        
        // 处理响应
        if (response.data && response.data.data) {
            const data = JSON.parse(response.data.data).output;
            const successCount = data.filter(item => item === "success").length;
            const failureCount = data.filter(item => item !== "success").length;

            if (failureCount === 0) {
                return res.json({ message: '处理成功' });
            } else {
                const errorItems = data.map((result, idx) => {
                    if (result !== "success") {
                        return {
                            index: idx,
                            error: result // 错误信息
                        };
                    }
                    return null;
                }).filter(item => item !== null);

                return res.status(400).json({
                    error: '处理过程中出现错误',
                    details: errorItems
                });
            }
        } else {
            return res.status(500).json({ error: 'API 返回无效数据' });
        }
    } catch (error) {
        console.error('API 调用错误:', error);
        return res.status(500).json({ error: '调用 API 失败, 请检查参数或者cookies是否有效' });
    }
});

// 添加一个API端点用于手动更新cookies
app.post('/update-cookies', async (req, res) => {
    const result = await fetchCookiesList();
    res.json(result);
});

// 确保服务器使用http.Server实例监听
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
    console.log(`服务器运行在端口 ${PORT}`);

    const authTokenResult = await getAuthToken();
    if (authTokenResult.success) {
        console.log('服务器启动时成功获取Token');
    } else {
        console.error('服务器启动时获取Token失败:', authTokenResult.message);
    }
    
    // 服务器启动时获取cookies
    console.log('正在初始化Cookies列表...');
    const result = await fetchCookiesList();
    if (result.success) {
        console.log('服务器启动时成功获取Cookies');
    } else {
        console.error('服务器启动时获取Cookies失败:', result.message);
    }
    

}); 