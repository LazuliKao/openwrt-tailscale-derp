'use strict';
'require view';
'require form';
'require rpc';
'require ui';
'require uci';

var pendingStatusStorageKey = 'go-tailscale-derp.pendingStatus';

function isSocketAddress(value) {
    return /^(:\d+|[^\s:]+:\d+)$/.test(value);
}

function validateSocketAddress(title, value) {
    if (!value)
        return title + ' is required';

    if (!isSocketAddress(value))
        return title + ' must be in :port or host:port format';

    return true;
}

function validatePeerList(sectionId, value) {
    var i;

    if (!value || !value.length)
        return true;

    for (i = 0; i < value.length; i++) {
        if (!isSocketAddress(value[i]))
            return 'Mesh peers must be in :port or host:port format';
    }

    return true;
}

function validateTLSPair(sectionId, value, option, sibling) {
    var siblingValue = option.section.formvalue(sectionId, sibling) || '';

    if ((value && !siblingValue) || (!value && siblingValue))
        return 'Certificate and key must be provided together';

    return true;
}

function firstOption(map, sectionId, optionName) {
    var options = map.lookupOption(optionName, sectionId);

    return options && options.length ? options[0] : null;
}

function optionFormValue(map, sectionId, optionName, fallback) {
    var option = firstOption(map, sectionId, optionName);
    var value = option ? option.formvalue(sectionId) : null;

    return (value == null || value === '') ? fallback : value;
}

function boolFormValue(map, sectionId, optionName, fallback) {
    var value = optionFormValue(map, sectionId, optionName, fallback ? '1' : '0');

    return value === true || value === '1' || value === 1;
}

function captureExpectedStatus(map) {
    return {
        enabled: boolFormValue(map, 'global', 'enabled', false),
        listen: optionFormValue(map, 'global', 'listen', ':3478'),
        stun: boolFormValue(map, 'global', 'stun', true),
        mesh: boolFormValue(map, 'mesh', 'enabled', false),
        metrics: optionFormValue(map, 'ops', 'metrics', ':9911'),
        health: optionFormValue(map, 'ops', 'health', ':9912')
    };
}

function savePendingStatus(expectedStatus) {
    if (!window.sessionStorage)
        return;

    expectedStatus.savedAt = Date.now();
    window.sessionStorage.setItem(pendingStatusStorageKey, JSON.stringify(expectedStatus));
}

function clearPendingStatus() {
    if (window.sessionStorage)
        window.sessionStorage.removeItem(pendingStatusStorageKey);
}

var callReloadConfig = rpc.declare({
    object: 'go-tailscale-derp',
    method: 'reload_config',
    expect: { '': {} }
});

return view.extend({
    load: function() {
        return Promise.all([
            uci.load('go-tailscale-derp')
        ]);
    },

    handleSaveApply: function(ev, mode) {
        var expectedStatus = captureExpectedStatus(this.map);

        return this.super('handleSaveApply', [ev, mode]).then(function() {
            return callReloadConfig();
        }).then(function() {
            savePendingStatus(expectedStatus);
            window.location.href = L.url('admin', 'services', 'derp', 'status');
        }).catch(function(err) {
            clearPendingStatus();
            ui.addNotification(null, E('p', {}, 'Failed to reload DERP configuration: ' +
                (err && err.message ? err.message : 'unknown error')));
            throw err;
        });
    },

    render: function() {
        var m, s, o;

        m = new form.Map('go-tailscale-derp', 'Tailscale DERP Relay',
            'Configure the Tailscale DERP relay server.');
        this.map = m;

        // --- Settings Section ---
        s = m.section(form.TypedSection, 'settings', 'Global Settings');
        s.anonymous = true;

        o = s.option(form.Flag, 'enabled', 'Enable Service',
            'Start DERP service on boot');
        o.default = '0';
        o.rmempty = false;

        o = s.option(form.Value, 'listen', 'Listen Address',
            'Address and port for DERP/STUN (e.g. :3478)');
        o.default = ':3478';
        o.rmempty = false;
        o.placeholder = ':3478';
        o.validate = function(sectionId, value) {
            return validateSocketAddress('Listen address', value);
        };

        o = s.option(form.Flag, 'stun', 'Enable STUN',
            'Enable STUN server on the same port');
        o.default = '1';
        o.rmempty = false;

        // --- TLS Section ---
        s = m.section(form.TypedSection, 'tls', 'TLS Settings');
        s.anonymous = true;

        o = s.option(form.Value, 'certfile', 'Certificate File',
            'Path to TLS certificate (leave empty for auto)');
        o.placeholder = '/etc/ssl/certs/derp.pem';
        o.rmempty = true;
        o.validate = function(sectionId, value) {
            return validateTLSPair(sectionId, value, this, 'keyfile');
        };

        o = s.option(form.Value, 'keyfile', 'Key File',
            'Path to TLS private key (leave empty for auto)');
        o.placeholder = '/etc/ssl/private/derp.key';
        o.rmempty = true;
        o.validate = function(sectionId, value) {
            return validateTLSPair(sectionId, value, this, 'certfile');
        };

        // --- Mesh Section ---
        s = m.section(form.TypedSection, 'mesh', 'Mesh Settings');
        s.anonymous = true;

        o = s.option(form.Flag, 'enabled', 'Enable Mesh',
            'Enable DERP mesh mode');
        o.default = '0';
        o.rmempty = false;

        o = s.option(form.DynamicList, 'peers', 'Mesh Peers',
            'List of peer DERP server addresses');
        o.rmempty = true;
        o.depends('enabled', '1');
        o.validate = validatePeerList;

        // --- Ops Section ---
        s = m.section(form.TypedSection, 'ops', 'Operations');
        s.anonymous = true;

        o = s.option(form.Value, 'metrics', 'Metrics Port',
            'Port for Prometheus metrics endpoint');
        o.default = ':9911';
        o.rmempty = false;
        o.placeholder = ':9911';
        o.validate = function(sectionId, value) {
            return validateSocketAddress('Metrics address', value);
        };

        o = s.option(form.Value, 'health', 'Health Port',
            'Port for health check endpoint');
        o.default = ':9912';
        o.rmempty = false;
        o.placeholder = ':9912';
        o.validate = function(sectionId, value) {
            return validateSocketAddress('Health address', value);
        };

        return m.render();
    }
});
