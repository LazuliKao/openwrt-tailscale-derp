'use strict';
'require view';
'require rpc';
'require poll';
'require ui';

var pendingStatusStorageKey = 'go-tailscale-derp.pendingStatus';
var pendingStatusMaxAgeMs = 5 * 60 * 1000;

var actionCalls = {
    start: rpc.declare({
        object: 'go-tailscale-derp',
        method: 'start',
        expect: { '': {} }
    }),
    stop: rpc.declare({
        object: 'go-tailscale-derp',
        method: 'stop',
        expect: { '': {} }
    }),
    restart: rpc.declare({
        object: 'go-tailscale-derp',
        method: 'restart',
        expect: { '': {} }
    }),
    reload: rpc.declare({
        object: 'go-tailscale-derp',
        method: 'reload_config',
        expect: { '': {} }
    })
};

var callStatus = rpc.declare({
    object: 'go-tailscale-derp',
    method: 'get_status',
    expect: { '': {} }
});

var callVersion = rpc.declare({
    object: 'go-tailscale-derp',
    method: 'get_version',
    expect: { '': {} }
});

function normalizeStatus(data) {
    return {
        running: !!data.running,
        listen: data.listen || 'Not configured',
        stun: data.stun ? 'Yes' : 'No',
        mesh: data.mesh ? 'Yes' : 'No',
        metrics: data.metrics || ':9911',
        health: data.health || ':9912',
        error: data.error || ''
    };
}

function setText(id, value) {
    var el = document.getElementById(id);

    if (el)
        el.textContent = value;
}

function setActionResult(kind, message) {
    var el = document.getElementById('ops-result');

    if (!el)
        return;

    el.style.color = kind === 'error' ? '#c00' : '#090';
    el.textContent = message;
}

function setActionButtonsDisabled(disabled) {
    var buttons = document.querySelectorAll('[data-derp-action]');
    var i;

    for (i = 0; i < buttons.length; i++)
        buttons[i].disabled = disabled;
}

function actionLabel(action) {
    switch (action) {
    case 'start':
        return 'Start';
    case 'stop':
        return 'Stop';
    case 'restart':
        return 'Restart';
    case 'reload':
        return 'Reload';
    default:
        return action;
    }
}

function shouldConfirm(action) {
    return action === 'stop' || action === 'restart';
}

function invokeAction(action) {
    var call = actionCalls[action];

    if (!call)
        return Promise.reject(new Error('Unsupported action: ' + action));

    return call();
}

function renderOfflineState(message) {
    setText('derp-status', 'Offline');
    setText('derp-version', 'Unavailable');
    setText('derp-listen', 'Unavailable');
    setText('derp-stun', 'Unknown');
    setText('derp-mesh', 'Unknown');
    setText('derp-metrics', 'Unavailable');
    setText('derp-health', 'Unavailable');
    setText('derp-error', message || 'Status backend unavailable');
    renderSyncState(null, message || 'Status backend unavailable');
}

function readPendingStatus() {
    if (!window.sessionStorage)
        return null;

    try {
        return JSON.parse(window.sessionStorage.getItem(pendingStatusStorageKey) || 'null');
    }
    catch (e) {
        window.sessionStorage.removeItem(pendingStatusStorageKey);
        return null;
    }
}

function clearPendingStatus() {
    if (window.sessionStorage)
        window.sessionStorage.removeItem(pendingStatusStorageKey);
}

function normalizeAddress(value) {
    var match;

    if (!value)
        return '';

    if (/^:\d+$/.test(value))
        return '0.0.0.0' + value;

    match = value.match(/^\[::\]:(\d+)$/);
    if (match)
        return '0.0.0.0:' + match[1];

    return value;
}

function isPendingExpired(pending) {
    return !pending.savedAt || (Date.now() - pending.savedAt) > pendingStatusMaxAgeMs;
}

function getSyncState(normalized, backendMessage) {
    var pending = readPendingStatus();

    if (!pending)
        return { color: '#666', text: 'No configuration change pending.', clear: false };

    if (isPendingExpired(pending)) {
        return {
            color: '#c60',
            text: 'Saved configuration status expired before it could be confirmed.',
            clear: true
        };
    }

    if (normalized && matchesPendingStatus(normalized, pending)) {
        return {
            color: '#090',
            text: 'Saved configuration is now active.',
            clear: true
        };
    }

    return {
        color: '#c60',
        text: backendMessage ?
            'Waiting for saved configuration to become active: ' + backendMessage :
            'Waiting for saved configuration to become active...',
        clear: false
    };
}

function matchesPendingStatus(normalized, pending) {
    if (!pending)
        return false;

    if (pending.enabled === false)
        return normalized.error !== '' || normalized.running === false;

    return normalized.running === true &&
        normalizeAddress(normalized.listen) === normalizeAddress(pending.listen) &&
        normalized.stun === (pending.stun ? 'Yes' : 'No') &&
        normalized.mesh === (pending.mesh ? 'Yes' : 'No') &&
        normalized.metrics === pending.metrics &&
        normalized.health === pending.health;
}

function renderSyncState(normalized, backendMessage) {
    var el = document.getElementById('derp-sync');
    var state = getSyncState(normalized, backendMessage);

    if (!el)
        return;

    if (state.clear)
        clearPendingStatus();

    el.style.color = state.color;
    el.textContent = state.text;
}

function renderStatus(status, version) {
    var normalized = normalizeStatus(status || {});

    setText('derp-status', normalized.running ? 'Running' : 'Stopped');
    setText('derp-version', (version && version.version) || 'Unknown');
    setText('derp-listen', normalized.listen);
    setText('derp-stun', normalized.stun);
    setText('derp-mesh', normalized.mesh);
    setText('derp-metrics', normalized.metrics);
    setText('derp-health', normalized.health);
    setText('derp-error', normalized.error || 'None');
    renderSyncState(normalized, normalized.error);
}

function pollStatus() {
    return Promise.all([
        callStatus(),
        callVersion()
    ]).then(function(data) {
        renderStatus(data[0] || {}, data[1] || {});
    }).catch(function(err) {
        renderOfflineState(err && err.message ? err.message : 'Status backend unavailable');
    });
}

return view.extend({
    handleAction: function(action) {
        var label = actionLabel(action);
        var message;

        if (shouldConfirm(action)) {
            message = 'Are you sure you want to ' + action + ' the DERP service?';
            if (!confirm(message)) {
                setActionResult('error', label + ' cancelled.');
                return Promise.resolve();
            }
        }

        setActionButtonsDisabled(true);
        setActionResult('success', label + ' in progress...');

        return invokeAction(action).then(function(result) {
            var response = result || {};
            var resultLabel = response.result || 'ok';
            var errorMessage = response.error;

            if (resultLabel !== 'ok' || errorMessage)
                throw new Error(errorMessage || (label + ' failed'));

            setActionResult('success', label + ' completed successfully.');
            return pollStatus();
        }).catch(function(err) {
            setActionResult('error', label + ' failed: ' + (err && err.message ? err.message : 'unknown error'));
            return pollStatus();
        }).finally(function() {
            setActionButtonsDisabled(false);
        });
    },

    load: function() {
        return Promise.all([
            callStatus().catch(function(err) {
                return { error: err && err.message ? err.message : 'Status backend unavailable' };
            }),
            callVersion().catch(function() {
                return { version: 'Unavailable' };
            })
        ]);
    },

    render: function(data) {
        var status = data[0] || {};
        var version = data[1] || {};
        var normalized = normalizeStatus(status);
        var initialState = normalized.error ? 'Offline' : (normalized.running ? 'Running' : 'Stopped');
        var initialVersion = normalized.error ? 'Unavailable' : (version.version || 'Unknown');
        var initialListen = normalized.error ? 'Unavailable' : normalized.listen;
        var initialStun = normalized.error ? 'Unknown' : normalized.stun;
        var initialMesh = normalized.error ? 'Unknown' : normalized.mesh;
        var initialMetrics = normalized.error ? 'Unavailable' : normalized.metrics;
        var initialHealth = normalized.error ? 'Unavailable' : normalized.health;
        var initialError = normalized.error || 'None';
        var initialSyncState = getSyncState(normalized, normalized.error);

        if (initialSyncState.clear)
            clearPendingStatus();

        var statusTable = E('table', { 'class': 'table' }, [
            E('tr', { 'class': 'tr' }, [
                E('td', { 'class': 'td' }, 'Service Status'),
                E('td', { 'class': 'td', 'id': 'derp-status' },
                    initialState)
            ]),
            E('tr', { 'class': 'tr' }, [
                E('td', { 'class': 'td' }, 'Version'),
                E('td', { 'class': 'td', 'id': 'derp-version' },
                    initialVersion)
            ]),
            E('tr', { 'class': 'tr' }, [
                E('td', { 'class': 'td' }, 'Listen Address'),
                E('td', { 'class': 'td', 'id': 'derp-listen' },
                    initialListen)
            ]),
            E('tr', { 'class': 'tr' }, [
                E('td', { 'class': 'td' }, 'STUN Enabled'),
                E('td', { 'class': 'td', 'id': 'derp-stun' },
                    initialStun)
            ]),
            E('tr', { 'class': 'tr' }, [
                E('td', { 'class': 'td' }, 'Mesh Enabled'),
                E('td', { 'class': 'td', 'id': 'derp-mesh' },
                    initialMesh)
            ]),
            E('tr', { 'class': 'tr' }, [
                E('td', { 'class': 'td' }, 'Metrics Address'),
                E('td', { 'class': 'td', 'id': 'derp-metrics' },
                    initialMetrics)
            ]),
            E('tr', { 'class': 'tr' }, [
                E('td', { 'class': 'td' }, 'Health Address'),
                E('td', { 'class': 'td', 'id': 'derp-health' },
                    initialHealth)
            ]),
            E('tr', { 'class': 'tr' }, [
                E('td', { 'class': 'td' }, 'Last Error'),
                E('td', { 'class': 'td', 'id': 'derp-error' },
                    initialError)
            ])
        ]);

        var card = E('div', { 'class': 'cbi-section' }, [
            E('h3', {}, 'DERP Server Status'),
            E('div', {
                'id': 'derp-sync',
                'style': 'margin-bottom: 0.75em; color: ' + initialSyncState.color + ';'
            }, initialSyncState.text),
            statusTable
        ]);

        var actions = E('div', { 'class': 'cbi-section', 'style': 'margin-top: 1em;' }, [
            E('h3', {}, 'Service Actions'),
            E('div', { 'class': 'cbi-section-node' }, [
                E('button', {
                    'class': 'cbi-button cbi-button-action',
                    'data-derp-action': 'start',
                    'click': ui.createHandlerFn(this, 'handleAction', 'start')
                }, 'Start'),
                ' ',
                E('button', {
                    'class': 'cbi-button cbi-button-negative',
                    'data-derp-action': 'stop',
                    'click': ui.createHandlerFn(this, 'handleAction', 'stop')
                }, 'Stop'),
                ' ',
                E('button', {
                    'class': 'cbi-button cbi-button-action',
                    'data-derp-action': 'restart',
                    'click': ui.createHandlerFn(this, 'handleAction', 'restart')
                }, 'Restart'),
                ' ',
                E('button', {
                    'class': 'cbi-button cbi-button-action',
                    'data-derp-action': 'reload',
                    'click': ui.createHandlerFn(this, 'handleAction', 'reload')
                }, 'Reload Config')
            ]),
            E('div', {
                'id': 'ops-result',
                'style': 'margin-top: 0.75em; min-height: 1.2em; color: #090;'
            }, 'No action executed yet.')
        ]);

        // Poll for updates every 5 seconds
        poll.add(function() {
            return pollStatus();
        }, 5);

        return E('div', {}, [
            E('h2', {}, 'Tailscale DERP Status'),
            card,
            actions
        ]);
    },

    handleSave: null,
    handleSaveApply: null,
    handleReset: null
});
