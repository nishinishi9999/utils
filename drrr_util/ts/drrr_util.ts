// ==UserScript==
// @name         DrrrUtil.js
// @namespace    https://github.com/robotoms/utils/tree/master/drrr_util
// @version      0.4.0
// @description  Multiple utilities for Drrr Chat
// @author       tounyuu
// @homepageURL  https://github.com/robotoms/utils/blob/master/drrr_util
// @supportURL   https://openuserjs.org/scripts/robotoms/DrrrUtil.js/issues
// @icon         http://drrrkari.com/css/icon_girl.png
// @match        http://drrrkari.com/room/
// @license      GPL-3.0-only
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        window.focus
// ==/UserScript==


/**
* TODO
*
* - User update is not updated each request
* - Set number of visible messages
* - on_send doesn't change the bubble element text
* - Think about some way of evading automatic disconnection
* - Hide admin-related buttons from user menu when you are not admin
* - Save a list of ips and their respective id?
* - Configure theme select events
*
**/


module DrrrUtil {
    'use strict';
    
    
    interface NotificationOptions {
        title   :string;
        image   :string;
        text    :string;
        timeout :number;
        onclick :() => void;
    }
    
    
    /**
    * Global variables
    **/
    let ROOM   :Room;
    let CONFIG :Config;

    
    /**
    * Constants
    **/
    const CSS_URL :{ [propName :string] :string } = Object.freeze({
        tooltip   : 'https://cdn.rawgit.com/robotoms/utils/2bc98a0c/drrr_util/css/tooltip.css',
        greyscale : 'https://cdn.rawgit.com/robotoms/utils/0a863f1b/drrr_util/css/greyscale.css'
    });
    
    
    /**
    * Classes
    **/
    class Config {
        public is_hover_menu          :boolean;  // Whether to show user menu on icon hover
        public is_autoban             :boolean;  // Room.autoban
        public is_notify              :boolean;  // Whether to send notifications
        public is_talk_info           :boolean;  // Whether to log talk info
        public is_update_unread       :boolean;  // Whether to update the title on unread messages
        public is_modify_send         :boolean;  // Whether to allow modifying send hooks
        public is_avoid_disconnection :boolean;  // Whether to avoid automatic disconnection
        public theme                  :string;   // Default theme
        
        public notify_triggers  :string[];
        
        public autoban: { [propName :string] :{
            [propName :string] :string[];
        }};
        
        
        constructor() {
            if( this.get_value('is_hover_menu') === undefined ) {
                this.save_default();
            }
            
            this.is_hover_menu          = this.get_value('is_hover_menu');
            this.is_autoban             = this.get_value('is_autoban');
            this.is_notify              = this.get_value('is_notify');
            this.is_talk_info           = this.get_value('is_talk_info');
            this.is_update_unread       = this.get_value('is_update_unread');
            this.is_modify_send         = this.get_value('is_modify_send');
            this.is_avoid_disconnection = this.get_value('is_avoid_disconnection');
            this.theme                  = this.get_value('theme');
            this.notify_triggers        = this.get_value('notify_triggers');
            this.autoban                = this.get_value('autoban');
        }
        
        public get_value(key :string) :any {
            const value = GM_getValue(key);
            
            switch(value === undefined) {
                case true : throw Error('Proprety isn\'t stored: ' + key);
                default   : return value;
            }
        }
        
        public set_value(key :string, value: any) :void {
            GM_setValue(key, value);
        }
        
        public set_data(json :{ [propName :string] :any }) :void | never {
            Object.keys(json).forEach( (key) => {
                switch(this[key] === undefined) {
                    case true : throw Error('Non-existent property: ' + key);
                    default   : this[key] = json[key];
                }
            });
        }
        
        public save_default() :void {
            this.set_value('is_hover_menu'          , true);
            this.set_value('is_autoban'             , true);
            this.set_value('is_notify'              , true);
            this.set_value('is_talk_info'           , true);
            this.set_value('is_update_unread'       , true);
            this.set_value('is_modify_send'         , false);
            this.set_value('is_avoid_disconnection' , false);
            this.set_value('theme'                  , 'default');

            this.set_value('notify_triggers'  , ['notifyme', '半角コンマで分別', 'こういう風に']);
            this.set_value('autoban', {
                kick: {
                    msg  : ['kickme', 'dontkickme', 'pleasedont'],
                    name : ['getkicked'],
                    ip   : ['abcdefgh']
                },
                ban: {
                    msg  : ['banme'],
                    name : ['getbanned'],
                    ip   : ['hgfedcba']
                }
            });
        }
        
        public save() :void {
            this.set_value('is_hover_menu'          , this.is_hover_menu);
            this.set_value('is_autoban'             , this.is_autoban);
            this.set_value('is_notify'              , this.is_notify);
            this.set_value('is_talk_info'           , this.is_talk_info);
            this.set_value('is_update_unread'       , this.is_update_unread);
            this.set_value('is_modify_send'         , this.is_modify_send);
            this.set_value('is_avoid_disconnection' , this.is_avoid_disconnection);
            this.set_value('theme'                  , this.theme);

            this.set_value('notify_triggers'        , this.notify_triggers);
            this.set_value('autoban'                , this.autoban);
        }
    }
    
    class Room {
        private host   :string;
        private talks  :{ [propName :string] :Talk };
        private users  :{ [propName :string] :User };
        private unread :number;
        
        private flags :{
            [propName :string] :boolean;
        };
        
        private msg_field :any;
        
        constructor() {
            this.host   = '';
            this.talks  = {};
            this.users  = {};
            this.unread = 0;
            
            this.flags = { HAS_LOADED: false };
            
            this.msg_field = $('[name=message]');
        }
        
        // Hook outcoming requests
        public hook_send(callback :(body :any) => any) :void {
            const _send = XMLHttpRequest.prototype.send;
    
            XMLHttpRequest.prototype.send = function(body :any) {
                const _body = callback(body);
    
                _send.call(this, _body);
            };
        }

        // Hook completed requests
        public hook_response(callback :(xhr_room :any) => void) :void {
            $.ajaxSetup({
                'complete': (xhr :any) => //(xhr, status)
                    callback( xhr.responseXML.children[0] ) // <Room>
            });
        }

        // Getters / Setters
        public set_host(id :string) :void {
            this.host = id;
        }
        
        public get_host() :string {
            return this.host;
        }
        
        public has_talk(id :string) :boolean {
            return this.talks[id] !== undefined;
        }
        
        public register_talk(talk :Talk) :void {
            this.talks[talk.id] = talk;
        }
        
        public talk(id :string) :Talk | undefined {
            return this.talks[id];
        }
        
        public has_user(id :string) :boolean {
            return this.users[id] !== undefined;
        }
        
        public register_user(user :User) :void {
            this.users[user.id] = user;
        }
        
        public unregister_user(user :User) :void {
            delete this.users[user.id]; ////
        }
        
        public user(id :string) :User | undefined {
            return this.users[id];
        }
        
        public user_with_name(name :string) :User | undefined {
            const users   = this.users;
            const user_id = Object.keys(this.users).find( (id) =>
                name === users[id].name
            );
            
            switch(user_id === undefined) {
                case true : return undefined;
                default   : return users[<string>user_id];
            }
        }
        
        public increment_unread() :void {
            this.unread++;
            this.update_title(this.unread);
        }
        
        public reset_unread() :void {
            this.unread = 0;
            this.update_title(this.unread);
        }
        
        public is_flag(flag :string) :boolean {
            return this.flags[flag];
        }
        
        public set_flag(flag :string) :void {
            this.flags[flag] = true;
        }
        
        public is_tab_hidden() :boolean {
            return document.hidden;
            //return (document.hidden || !!document.webkitHidden || document.msHidden);
        }
        
        public update_title(n :number) :void {
            const room = this.room_name();
            
            switch(n === 0) {
                case true: {
                    document.title = room;
                    break;
                }
                default: {
                    document.title = `${room} (${n})`;
                }
            }
        }

        // Own name as displayed inside the room
        public own_name() :string {
            return $('.profname').text();
        }
        
        public im_host() :boolean {
            return this.own_id() === this.host;
        }
        
        // Own id
        public own_id() :string {
            const name  = this.own_name();
            const users = this.users;
            const index = Object.keys(this.users).find( (id) =>
                users[id].name === name
            );
            
            switch(index !== undefined) {
                case true : return users[<string>index].id;
                default   : throw Error('User not found.');
            }
        }
        
        public room_name() :string {
            return $('#room_name').text().split(' ')[0];
        }
        
        public user_n() :number[] {
            const n_str = $('#room_name').text().split(' ')[1];
            
            return n_str.substr(1, n_str.length-2).split('/')
                .map( (n) => parseInt(n) );
        }
        
        // Send an ajax post request
        public post(json :{ [propName :string] :string | number }) :void {
            const url  = 'http://drrrkari.com/room/?ajax=1';
            const attr = Object.assign({valid: 1}, json);
            
            $.post(url, attr);
            
            /*
                .done  ( (data) => console.log('Message success:', data) )
                .fail  ( (err)  => console.error('Couldn\'t send message:', err) )
                .always( ()     => console.log('Message sent:', msg) );
            */
        }
        
        // Send a message
        public send_message(msg :string) :void {
            this.post({ message: msg });
        }
        
        public send_pm(msg :string, id :string) :void {
            this.post({ id: id, message: msg });
        }
        
        public change_user_limit(n :number | string) :void {
            this.post({ room_limit: n });
        }

        // Inject a link element with the given url
        public inject_css(url :string) :void {
            const style = $( document.createElement('LINK') )
                .attr('rel', 'stylesheet')
                .attr('type', 'text/css')
                .attr('href', url);
            
            $('head').append(style);
        }
        
        // Load a css in the CSS_URL constant
        public set_css(theme :string) :void {
            this.inject_css( CSS_URL[theme] );
        }
        
        // Get message field
        public get_msg_field() :string {
            return this.msg_field.val();
        }

        // Set message field
        public add_msg_field(str :string) :void {
            this.msg_field.val( this.get_msg_field() + str );
        }
        
        public focus_msg_field() {
            const textarea = <HTMLTextAreaElement>$('#message textarea')[0];
            const pos      = 1000; // Arbitrary number
            
            textarea.focus();
            textarea.selectionStart = pos;
            textarea.selectionEnd   = pos;
        }

        // Convert epoch timestamps to locale time
        public epoch_to_time(time :number) :string {
            const s = 1000;
            
            return (new Date( time*s ))
                .toLocaleTimeString();
        }

        // Send a notification (untested on chrome)
        public send_notification(options :NotificationOptions) :void {
            GM_notification(options);
        }
        
        // Send a private message to oneself every m minutes to stay alive
        public avoid_disconnection(m :number) :void {
            const ms   = 1000;
            const s    = 60;
            const time = m * s * ms;
            
            setInterval( () =>
                ROOM.send_pm( 'test', ROOM.own_id() )
            , time);
        }
        
        private config_textarea(label :string, id :string, data :string[]) {
            return $( document.createElement('DIV') ).append(
                $( document.createElement('LABEL') ).attr('for', id).text(label),
                $( document.createElement('INPUT') ).attr('id', id).val( data.join(',') ).css({
                    'width'        : '400px',
                    'height'       : '20px',
                    'padding-left' : '5px',
                    'margin-left'  : '20px'
                })
            );
        }
        
        private parse_textarea(line :string) :string[] {
            return line.split(/\s*,\s*/);
        }
        
        private toggle_config_menu() {
            $('.submit input[name=post]').slideToggle(); // Post button
            $('#message textarea')       .slideToggle(); // Message field
            $('.userprof')               .slideToggle(); // User picture/name
            $('#config_menu')            .slideToggle(); // Configuration div
        }
        
        public append_config() {
            const {is_notify, is_autoban} = CONFIG;
            const icon_url = 'https://i.imgsafe.org/9f/9f4ad930a2.png';
            
            const hr_el = $( document.createElement('HR') )
                .css({
                    'margin-top': '10px',
                    'margin-bottom': '10px'
                });
            
            const config_div = $( document.createElement('DIV') )
                .attr('id', 'config_menu')
                .addClass('pannel hide')
                .append('<br>');
            
            const notify_div = $( document.createElement('DIV') )
                .attr('id', 'notify_trigger_div')
                .addClass('pannel hide')
                .css({
                    'margin-left'   : '50px',
                    'margin-top'    : '8px',
                    'margin-bottom' : '5px'
                })
                .append( this.config_textarea('通知トリガー', 'notify_triggers', CONFIG.notify_triggers) );

            const autoban_div = $( document.createElement('DIV') )
                .attr('id', 'autoban_div')
                .addClass('pannel hide')
                .css({
                    'margin-left'   : '50px',
                    'margin-top'    : '8px',
                    'margin-bottom' : '5px'
                })
                .append(
                    $( document.createElement('SPAN') ).text('キック'),
                    this.config_textarea('名前', 'kick_name', CONFIG.autoban.kick.name),
                    this.config_textarea('単語', 'kick_msg', CONFIG.autoban.kick.msg),
                    this.config_textarea('ＩＰ', 'kick_ip', CONFIG.autoban.kick.ip),
                    
                    $( document.createElement('SPAN') ).text('BAN'),
                    this.config_textarea('名前', 'ban_name', CONFIG.autoban.ban.name),
                    this.config_textarea('単語', 'ban_msg', CONFIG.autoban.ban.msg),
                    this.config_textarea('ＩＰ', 'ban_ip', CONFIG.autoban.ban.ip)
                );
            
            
            const autoban_el = $(document.createElement('DIV')).append(
                $(document.createElement('LABEL')).attr('for', 'is_autoban').text('自動キック'),
                $(document.createElement('INPUT')).css('margin-left', '10px')
                    .attr({
                        type    : 'checkbox',
                        id      : 'is_autoban',
                        checked : is_autoban
                    }),
                
                $(document.createElement('BUTTON')).text('設定')
                    .css({
                        'margin-left' : '10px',
                        'margin-down' : '5px',
                        'width'       : '40px'
                    })
                    .on('click', () => autoban_div.slideToggle() )
            );
            
            const notify_el = $( document.createElement('DIV') ).append(
                $( document.createElement('LABEL') ).attr('for', 'is_notify').text('通知'),
                $( document.createElement('INPUT') ).css('margin-left', '10px')
                    .attr({
                        type    : 'checkbox',
                        id      : 'is_notify',
                        checked : is_notify
                    }),
                
                $(document.createElement('BUTTON')).text('設定')
                    .css({
                        'margin-left' : '10px',
                        'width'       : '40px'
                    })
                    .on('click', () =>
                        notify_div.slideToggle()
                    )
            );
            
            const theme_el = $( document.createElement('DIV') ).append(
                $( document.createElement('LABEL')  ).attr('for', 'theme_select').text('テーマ'),
                $( document.createElement('SELECT') ).attr('id', 'theme_select').css('margin-left', '10px').append(
                    $( document.createElement('OPTION') ).text('デフォルト').val('default'),
                    $( document.createElement('OPTION') ).text('白黒').val('greyscale').on('click', () =>
                        ROOM.set_css('greyscale')
                    )
                )
            ).css('padding-top', '5px');
            
            const button_div = $( document.createElement('DIV') ).append(
                // Save configuration
                $( document.createElement('BUTTON') )
                    .text('保存')
                    .css('width', '60px')
                    .on('click', () => {
                        CONFIG.set_data({
                            is_autoban      : $('#is_autoban').prop('checked'),
                            is_notify       : $('#is_notify').prop('checked'),
                            notify_triggers : this.parse_textarea( <string>$('#notify_triggers').val() ),
                            autoban: {
                                kick: {
                                    name : this.parse_textarea( <string>$('#kick_name').val() ),
                                    msg  : this.parse_textarea( <string>$('#kick_msg').val()  ),
                                    ip   : this.parse_textarea( <string>$('#kick_ip').val()   )
                                },
                                ban: {
                                    name : this.parse_textarea( <string>$('#ban_name').val() ),
                                    msg  : this.parse_textarea( <string>$('#ban_msg').val()  ),
                                    ip   : this.parse_textarea( <string>$('#ban_ip').val()   )
                                }
                            }
                        });
                    
                        CONFIG.save();
                        this.toggle_config_menu();
                    }),
                
                // Restore default configuration
                $( document.createElement('BUTTON') )
                    .text('元設定に戻す')
                    .css({
                        'width': '110px',
                        'margin-left': '10px'
                    })
                    .on('click', () => {
                        CONFIG.save_default();
                        this.toggle_config_menu();
                        
                        location.reload();
                    })
            );
            
            
            const icon = $(document.createElement('LI')).append(
                $( document.createElement('IMG') ).attr('src', icon_url)
            ).on('click', this.toggle_config_menu);
            
            
            
            config_div.append(autoban_el, autoban_div, notify_el, notify_div, theme_el, hr_el, button_div, '<br>');
            
            $('.message_box_inner').append(config_div);
            $('.menu li:eq(3)').after(icon);
        }
    }
    
    class XMLUtil {
        private xml :any;
        
        constructor(xml :any) {
            this.xml = xml;
        }
        
        // Get the text content of a XML node
        private text() :string {
            return this.xml.textContent;
        }

        // Get the text content of a XML's child node
        public child_text(t_nodeName :string) :string {
            for(let i = 0; i < this.xml.children.length; i++) {
                if(this.xml.children[i].nodeName === t_nodeName) {
                    const _xml = new XMLUtil(this.xml.children[i]);
                    
                    return _xml.text();
                }
            }

            return '';
        }
    
        // Filter XML children by nodeName
        private filter_children(t_nodeName :string) :any[] {
            const filtered = [];
        
            for(let i = 0; i < this.xml.children.length; i++) {
                if(this.xml.children[i].nodeName === t_nodeName) {
                    filtered.push(this.xml.children[i]);
                }
            }
    
            return filtered;
        }
        
        public get_host() {
            return this.child_text('host');
        }
        
        // Format and get new talks
        public new_talks() :Talk[] {
            const talks = this.filter_children('talks');
            const new_talks = [];

            for(let i = 0; i < talks.length; i++) {
                const talk = new Talk(talks[i]);
                
                if( !talk.is_registered() ) {
                    new_talks.push(talk);
                }
            }

            return new_talks;
        }
        
        // Format and get new users
        public new_users() :User[] {
            const users = this.filter_children('users');
            const new_users = [];
            
            for(let i = 0; i < users.length; i++) {
                const user = new User(users[i]);
                
                if( !user.is_registered() ) {
                    new_users.push(user);
                }
            }
            
            return new_users;
        }
    }
    
    class Talk {
        public id       :string;
        public type     :string;
        public uid      :string;
        public encip    :string;
        public name     :string;
        public message  :string;
        public icon     :string;
        public time     :number;
        //private el      :any;
        private icon_el :any;
        
        constructor(xml :any) {
            const _xml  = new XMLUtil(xml);
            const icon  = _xml.child_text('icon')
                || 'girl';
            
            const uid = _xml.child_text('uid');
            
            let encip = _xml.child_text('encip');
            if(encip === '') {
                const _user = ROOM.user(uid);
                if(_user) { encip = _user.encip; }
            }
            
            this.id      = _xml.child_text('id');
            this.type    = _xml.child_text('type');
            this.uid     = uid;
            this.encip   = encip;
            this.name    = _xml.child_text('name');
            this.message = _xml.child_text('message');
            this.icon    = icon;
            this.time    = parseInt( _xml.child_text('time') );
            //this.el      = $('#' + _xml.child_text('id'));
            this.icon_el = $( $('#' + _xml.child_text('id')).children()[0] );
        }
        
        // Check if the message contains user's name
        public has_own_name() :boolean {
            return !!this.message.match( ROOM.own_name() );
        }
        
        // Check if the talk has been posted by the user
        public is_me() :boolean {
            return this.uid === ROOM.own_id();
        }
        
        // Check if the talk has been registered in the room
        public is_registered() :boolean {
            return ROOM.has_talk(this.id);
        }

        // Register the talk in the room
        public register() :void {
            ROOM.register_talk(this);
        }
        
        // Check if the talk's message contains a trigger of CONFIG.notify_triggers
        public has_trigger() :boolean {
            const msg = this.message;
            
            return CONFIG.notify_triggers.some( (trigger :string) => {
                const regex = new RegExp(trigger, 'i');
                
                return regex.test(msg);
            });
        }
        
        // Match the message against a list of words
        public msg_matches(list :string[]) :boolean {
            const msg = this.message;
            
            return list.some( (str) => {
                const regex = new RegExp(str, 'i');
                
                return regex.test(msg); 
            });
        }

        // Match the encip against a list of words
        public encip_matches(list :string[]) :boolean {
            const encip = this.encip;
            
            switch(encip === '') {
                case true : return false;
                default   : return list.some( (_encip) => _encip === encip );
            }
        }

        // Search for a match for notify()
        public try_notify() :void {
           if( !this.is_me() && this.has_trigger() ) {
               this.notify();
           }
        }
        
        // Notify the talk
        public notify() :void {
            const icon     = this.icon;
            const title    = this.name;
            const msg      = this.message;
            const icon_url = `http://drrrkari.com/css/icon_${icon}.png`;
            
            const options = {
                title     : title,
                image     : icon_url,
                highlight : true,
                text      : msg,
                timeout   : 5000,
                onclick   : window.focus
            };
            
            ROOM.send_notification(options);
        }
        
        // Log talk's info
        public print_info() :void {
            console.log();
            console.log(this.message);
            console.log('ID',   this.id);
            console.log('UID',  this.uid);
            console.log('TIME', ROOM.epoch_to_time(this.time));
            console.log();
        }
        
        // append_hover_menu() helper
        private tooltip_header(text :string) :any {
            return $( document.createElement('DIV') )
                .addClass('talk_tooltip_header')
                .append(
                    $( document.createElement('SPAN') )
                        .addClass('talk_tooltip_text')
                        .addClass('noselect')
                        .text(text)
                );
        }
        
        // append_hover_menu() helper
        private tooltip_btn(text :string) :any {
            return $( document.createElement('BUTTON') )
                .addClass('talk_tooltip_btn')
                .text(text);
        }
        
        // Append user menu to the talk icon
        public append_hover_menu() :void {
            const name  = this.name;
            const time  = this.time;
            const uid   = this.uid;
            const encip = this.encip;
            const prop_len = 10;
            
            const tooltip = $( document.createElement('DIV') )
                .addClass('talk_tooltip')
                .append(
                    this.tooltip_header('ユーザーメニュ'),
                        
                    $( document.createElement('DIV') )
                        .addClass('talk_tooltip_btn_div')
                        .append(
                            this.tooltip_btn('投稿時間: ' + ROOM.epoch_to_time(time)),
                            
                            this.tooltip_btn('IP: ' + (encip.substr(0, prop_len) || 'null')).on('click', (e :Event) => {
                                // copy ip to message box
                                ROOM.add_msg_field(this.encip || 'null');
                                ROOM.focus_msg_field();
                                
                                e.preventDefault();
                                e.stopPropagation();
                            }),
                            
                            this.tooltip_btn('内緒モード').on('click', (e :Event) => {
                                // Click on the target user
                                $(`#user_list2 > li[name=${this.uid}]`).trigger('click');
                                
                                // Open private window
                                $('[name=pmbtn]').trigger('click');
                                
                                e.preventDefault();
                                e.stopPropagation();
                            }),
                            this.tooltip_btn('無視').on('click', (e :Event) => {
                                const user = ROOM.user(uid);
                                if(user) { user.ignore(); }
                                
                                e.preventDefault();
                                e.stopPropagation();
                            }),
                            this.tooltip_btn('キック').on('click', (e :Event) => {
                                const user = ROOM.user(uid);
                                if(user) { user.kick(); }

                                e.preventDefault();
                                e.stopPropagation();
                            }),
                            this.tooltip_btn('バン').on ('click', (e :Event) => {
                                const user = ROOM.user(uid);
                                if(user) { user.ban(); }

                                e.preventDefault();
                                e.stopPropagation();
                            })
                        )
                );
            
            
            this.icon_el.on( 'click', () => {
                ROOM.add_msg_field( ROOM.get_msg_field() === ''
                    ? `@${name} `
                    : ` @${name}`
                );
                
                ROOM.focus_msg_field();
            });
            this.icon_el.append(tooltip);
        }
        
        public try_autoban() :boolean {
            if( ROOM.im_host() ) {
                const kick_list = CONFIG.autoban.kick;
                const ban_list  = CONFIG.autoban.ban;
            
                // By ip
                if( this.encip_matches(kick_list.ip) ) {
                    const user = ROOM.user(this.uid);
                    if(user) { user.kick(); }
                }
                else if( this.encip_matches(ban_list.ip) ) {
                    const user = ROOM.user(this.uid);
                    if(user) { user.ban(); }
                }
                
                // By message
                else if( this.msg_matches(kick_list.msg) ) {
                    const user = ROOM.user(this.uid);
                    if(user) { user.kick(); }
                }
                else if( this.msg_matches(ban_list.msg) ) {
                    const user = ROOM.user(this.uid);
                    if(user) { user.ban(); }
                }
                
                // Didn't succeed
                else {
                    return false;
                }
                
                return true;
            }
            else {
                return false;
            }
        }
    }
    
    class User {
        public name   :string;
        public id     :string;
        public icon   :string;
        public trip   :string;
        public encip  :string;
        public update :number;
        
        constructor(xml :any) {
            const _xml = new XMLUtil(xml);
            
            this.name   = _xml.child_text('name');
            this.id     = _xml.child_text('id');
            this.icon   = _xml.child_text('icon');
            this.encip  = _xml.child_text('encip');
            this.trip   = _xml.child_text('trip');
            this.update = parseFloat( _xml.child_text('update') );
        }
        
        // Check if it's registered in the room
        public is_registered() :boolean {
            return ROOM.has_user(this.id);
        }

        // Register the user in the room
        public register() {
            ROOM.register_user(this);
        }
        
        // Match user's name against a list of words
        public name_matches(list :string[]) :boolean {
            const name = this.name;
            
            return list.some( (str) => {
                const regex = new RegExp(str, 'i');
                
                return regex.test(name);
            });
        }

        // Match the encip against a list of words
        public encip_matches(list :string[]) :boolean {
            const encip = this.encip;
            
            switch(encip === '') {
                case true : return false;
                default   : return list.some( (_encip) => _encip === encip );
            }
        }
        
        // Hide the talks from that user
        public ignore() {
            alert('未実装！');
        }
        
        // Kick the user from the room (owner mode)
        public kick() {
            ROOM.post({ ban_user: this.id });
        }
        
        // Ban the user from the room (owner mode)
        public ban() {
            ROOM.post({ ban_user: this.id, block: 1 });
        }

        // Automatically kick or ban a user given the keywords on CONFIG.autoban
        public try_autoban() :boolean {
            if( ROOM.im_host() ) {
                const kick_list = CONFIG.autoban.kick;
                const ban_list  = CONFIG.autoban.ban;
                
                // By ip
                if( this.encip_matches(kick_list.ip) ) {
                    this.kick();
                }
                else if( this.encip_matches(ban_list.ip) ) {
                    this.ban();
                }
                
                // By name
                else if( this.name_matches(kick_list.name) ) {
                    this.kick();
                }
                else if( this.name_matches(ban_list.name) ) {
                    this.ban();
                }
                
                else {
                    return false;
                }
                
                return true;
            }
            else {
                return false;
            }
        }
    }
    
    /**
    * Functions
    **/
    function parse_send(body :string) :string[][] {
        return body.split('&').map( (pairs) => pairs.split('=') );
    }
    
    function join_send(parts :string[][]) :string {
        return parts.map( (pair) => pair.join('=') ).join('&');
    }
    
    
    /**
    * Handlers
    **/
    
    // Triggered before send
    function on_send(body :string | null) :string | null {
        switch(body === null) {
            case true: return null;
            default: {
                console.log('SEND', body);

                switch(CONFIG.is_modify_send) {
                    case true: {
                        const parts    = parse_send(<string>body);
                        const msg_pair = <string[]>parts.find( (arr) => arr[0] === 'message' );
                        
                        switch(msg_pair === undefined) {
                            case true: return body;
                            default: {
                                // Modify msg
                                let msg = decodeURI(msg_pair[1]).trim();
                                msg = 'abcd';
                                
                                
                                msg_pair[1] = encodeURI(msg + '\r\n');
                                
                                return join_send(parts);
                            }
                        }
                    }
                    default: return body;
                }
            }
        }
    }
    
    // Triggered on request completion
    function on_response(xml_room :any) :void {
        //console.log('RESPONSE', xml_room);
        //console.log(ROOM);
        
        const xml = new XMLUtil(xml_room);
        
        // Register new entries
        ROOM.set_host( xml.get_host() );
        
        const users = xml.new_users();
        users.forEach( (user) => user.register() );
        
        const talks = xml.new_talks();
        talks.forEach( (talk) => talk.register() );
        
        
        // Send to handlers
        if( ROOM.is_flag('HAS_LOADED') ) {
            if(users.length !== 0) {
                users.forEach( (user) => {
                    if(CONFIG.is_autoban) {
                        user.try_autoban();
                    }
                    
                    handle_users(user);
                });
            }
            
            if(talks.length !== 0)　{
                talks.forEach( (talk) => {
                    if(CONFIG.is_notify) {
                        talk.try_notify();
                    }
                    
                    if(talk.uid === '0') {
                        handle_system_msg(talk.message);
                    }
                    else {
                        if(CONFIG.is_autoban)    {　talk.try_autoban(); }
                        if(CONFIG.is_hover_menu) { talk.append_hover_menu(); }
                        if(CONFIG.is_talk_info)  { talk.print_info(); }
                        
                        if( CONFIG.is_update_unread && ROOM.is_tab_hidden() ) {
                            ROOM.increment_unread();
                        }
                        else if( CONFIG.is_update_unread ) {
                            ROOM.reset_unread();
                        }
                        
                        handle_talks(talk);
                    }
                });
            }
        }
        else {
            // Initialization
            console.log('INITIALIZATION', talks, users);
            
            talks.forEach( (talk) => {
                if(CONFIG.is_hover_menu) { talk.append_hover_menu(); }
            });
            
            ROOM.set_flag('HAS_LOADED');
        }
    }
    
    // Handle system messages
    function handle_system_msg(msg :string) :void {
        const hyphen_end = 3;
        const [name, event] = msg.substr(hyphen_end).split('さん');
        console.log('SYSTEM', name, event);
        
        switch(event) {
            case 'が入室しました': break;
            case 'が退室しました':
            case 'の接続が切れました': {
                const user = ROOM.user_with_name(name);
                
                if(user) {
                    ROOM.unregister_user(user);
                }
                
                break;
            }
            
            default: throw Error(`Unknown event: ${name} ${event}`);
        }
    }
    
    // Handle new talks
    function handle_talks(talk :Talk) :void {
        console.log('TALK', talk);
    }
    
    // Handle new users
    function handle_users(user :User) :void {
        console.log('USER', user);
        
        //user.kick();
    }

    function main() :void {
        CONFIG = new Config();
        ROOM   = new Room();
        
        // Hooks
        ROOM.hook_send(on_send);
        ROOM.hook_response(on_response);
        
        // Avoid disconnection
        if(CONFIG.is_avoid_disconnection) {
            const s = 10;
            
            ROOM.avoid_disconnection(s);
        }
        
        // CSS
        if(CONFIG.theme !== 'default') {
            ROOM.set_css(CONFIG.theme);
        }
        
        ROOM.set_css('tooltip');
        
        // Configuration
        ROOM.append_config();
        
        // Unread update
        ROOM.update_title(0);
        document.onfocus = ROOM.reset_unread;
        
        console.log('LOAD END');
    }
    
    
    main();
}
