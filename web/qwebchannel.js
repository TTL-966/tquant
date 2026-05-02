/****************************************************************************
**
** Copyright (C) 2016 The Qt Company Ltd.
** Contact: https://www.qt.io/licensing/
**
** This file is part of the QtWebChannel module of the Qt Toolkit.
**
** $QT_BEGIN_LICENSE:LGPL$
** Commercial License Usage
** Licensees holding valid commercial Qt licenses may use this file in
** accordance with the commercial license agreement provided with the
** Software or, alternatively, in accordance with the terms contained in
** a written agreement between you and The Qt Company. For licensing terms
** and conditions see https://www.qt.io/terms-conditions. For further
** information use the contact form at https://www.qt.io/contact-us.
**
** GNU Lesser General Public License Usage
** Alternatively, this file may be used under the terms of the GNU Lesser
** General Public License version 3 as published by the Free Software
** Foundation and appearing in the file LICENSE.LGPL3 included in the
** packaging of this file. Please review the following information to
** ensure the GNU Lesser General Public License version 3 requirements
** will be met: https://www.gnu.org/licenses/lgpl-3.0.html.
**
** GNU General Public License Usage
** Alternatively, this file may be used under the terms of the GNU
** General Public License version 2.0 or (at your option) the GNU General
** Public license version 3 or any later version approved by the KDE Free
** Qt Foundation. The licenses are as listed in the file LICENSE.GPL2 and
** LICENSE.GPL3. Please review the following information to ensure the
** GNU General Public License requirements will be met:
** https://www.gnu.org/licenses/gpl-2.0.html and
** https://www.gnu.org/licenses/gpl-3.0.html.
**
** $QT_END_LICENSE$
**
****************************************************************************/

"use strict";

var QWebChannel = function(transport, initCallback)
{
    if (typeof transport !== "object" || typeof transport.send !== "function") {
        throw new Error("The QWebChannel expects a transport object with a send function and onmessage callback property." +
                        " Please provide a WebSocket, send method, or similar.");
    }

    var channel = this;
    this.transport = transport;
    this.transport.onmessage = function(message)
    {
        var data = JSON.parse(message.data);
        switch (data.type) {
            case "response":
                if (channel.pendingCalls[data.id]) {
                    var pending = channel.pendingCalls[data.id];
                    if (data.error) {
                        pending.reject(data.error);
                    } else {
                        pending.resolve(data.result);
                    }
                    delete channel.pendingCalls[data.id];
                }
                break;
            case "signal":
                var signal = channel.objects[data.object];
                if (signal) {
                    signal.signalEmitted(data.signal, data.args);
                } else {
                    console.warn("QWebChannel: received signal for unknown object", data.object);
                }
                break;
            case "propertyUpdate":
                channel.propertyUpdate(data);
                break;
            case "init":
                channel.initCallback = initCallback;
                channel.init = data;
                channel.initialized = true;
                channel.execInitCallback();
                break;
            default:
                console.warn("QWebChannel: unknown message type:", data.type);
        }
    };

    this.execInitCallback = function()
    {
        if (this.initCallback) {
            this.initCallback(this);
            this.initCallback = null;
        }
    };

    this.send = function(data)
    {
        this.transport.send(JSON.stringify(data));
    };

    this.pendingCalls = {};
    this.objects = {};
    this.init = {};
    this.initialized = false;

    this.propertyUpdate = function(data)
    {
        var object = this.objects[data.object];
        if (object) {
            object.propertyUpdate(data);
        }
    };

    this.signalEmitted = function(data)
    {
        var object = this.objects[data.object];
        if (object) {
            object.signalEmitted(data.signal, data.args);
        }
    };

    // 初始化时请求远程对象
    this.send({ type: "init" });
};

QWebChannel.prototype = {
    constructor: QWebChannel
};
