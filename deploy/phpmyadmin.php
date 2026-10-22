<?php
// Only Caddy publishes this service, over HTTPS.
if (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') {
    $_SERVER['HTTPS'] = 'on';
}
$cfg['Servers'][1]['auth_type'] = 'cookie';
$cfg['Servers'][1]['AllowRoot'] = false;
$cfg['Servers'][1]['AllowNoPassword'] = false;
$cfg['Servers'][1]['only_db'] = ['garmintrainer'];
$cfg['Servers'][1]['AllowDeny']['order'] = 'explicit';
$cfg['Servers'][1]['AllowDeny']['rules'] = ['allow dbviewer from all'];
$cfg['AllowArbitraryServer'] = false;
$cfg['CookieSameSite'] = 'Strict';
$cfg['LoginCookieValidity'] = 1800;
