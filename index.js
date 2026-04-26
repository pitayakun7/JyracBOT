const {
    Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField,
    StringSelectMenuBuilder, ActivityType, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const express = require('express');
const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages]
});

const ticketMessages = new Map();
const activities = [
    "JYRAC公式Instはこちら！▶https://www.instagram.com/jyrac_official/",
    "NSF公式Instはこちら！▶https://www.instagram.com/2024nsfproject/",
    "ボットに関するお問い合わせはDisID’pitayakun7’まで",
    "①広告募集中", 
    "②広告募集中"
];

const commands = [
    new SlashCommandBuilder().setName('verify').setDescription('認証パネルを作成')
    .addRoleOption(o => o.setName('role').setDescription('付与するロール').setRequired(true))
    .addStringOption(o => o.setName('title').setDescription('パネルタイトル'))
    .addStringOption(o => o.setName('description').setDescription('説明文'))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles),
    
    new SlashCommandBuilder().setName('ticket').setDescription('チケットパネルを作成')
    .addRoleOption(o => o.setName('admin-role').setDescription('対応管理ロール').setRequired(true))
    .addStringOption(o => o.setName('title').setDescription('タイトル'))
    .addStringOption(o => o.setName('description').setDescription('説明文'))
    .addStringOption(o => o.setName('panel-desc').setDescription('チケット作成時メッセージ'))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),
    
    new SlashCommandBuilder().setName('role-confirmation').setDescription('指定ユーザーのロールを確認')
    .addUserOption(o => o.setName('target').setDescription('確認対象').setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers),
    
    new SlashCommandBuilder().setName('delete').setDescription('メッセージを一括削除')
    .addIntegerOption(o => o.setName('amount').setDescription('件数(1-100)').setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages),
    
    new SlashCommandBuilder().setName('help').setDescription('コマンド一覧と詳細を表示'),
    
    // give-role コマンドの定義
　　new SlashCommandBuilder().setName('give-role').setDescription('複数のユーザーにロールを付与')
    .addRoleOption(o => o.setName('role').setDescription('付与するロール').setRequired(true))
    .addUserOption(o => o.setName('target1').setDescription('対象1').setRequired(true))
    .addUserOption(o => o.setName('target2').setDescription('対象2'))
    .addUserOption(o => o.setName('target3').setDescription('対象3'))
    .addUserOption(o => o.setName('target4').setDescription('対象4'))
    .addUserOption(o => o.setName('target5').setDescription('対象5'))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles),
　　new SlashCommandBuilder().setName('give-role').setDescription('複数のユーザーにロールを付与')
    .addRoleOption(o => o.setName('role').setDescription('付与するロール').setRequired(true))
    .addUserOption(o => o.setName('target1').setDescription('対象1').setRequired(true))
    .addUserOption(o => o.setName('target2').setDescription('対象2'))
    .addUserOption(o => o.setName('target3').setDescription('対象3'))
    .addUserOption(o => o.setName('target4').setDescription('対象4'))
    .addUserOption(o => o.setName('target5').setDescription('対象5'))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles),

    new SlashCommandBuilder().setName('receive-notifications').setDescription('重要なお知らせの通知登録を行う'),
    
    new SlashCommandBuilder().setName('notice').setDescription('お知らせを送信(管理者専用)')
    .addStringOption(o => o.setName('password').setDescription('認証パスワード').setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles),

    new SlashCommandBuilder().setName('set-vc-log-channel').setDescription('VCログの送信先チャンネルを設定')
    .addChannelOption(o => o.setName('channel').setDescription('ログを送るチャンネル').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),

　　new SlashCommandBuilder().setName('record-vc-log').setDescription('現在のVCログを記録し送信')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),

    new SlashCommandBuilder().setName('set-text-log-channel').setDescription('テキストログの送信先を設定')
    .addChannelOption(o => o.setName('channel').setDescription('送信先').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),

　　new SlashCommandBuilder().setName('register-text-log').setDescription('現在のチャンネルをログ監視対象にする')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),
].map(c => c.toJSON());

client.once('clientReady', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    setInterval(() => {
        client.user.setActivity(activities[Math.floor(Math.random() * activities.length)], { type: ActivityType.Custom });
    }, 15000);
});

const app = express();
app.get('/', (req, res) => res.send('Bot is Active!'));
app.listen(3000);

client.on('interactionCreate', async interaction => {
    if (interaction.replied || interaction.deferred) return;
    const safeReply = async (data) => { if (!interaction.replied && !interaction.deferred) return await interaction.reply(data); };

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const doc = await db.collection('text_logs_config').doc(message.channel.id).get();
    if (doc.exists) {
        await db.collection('text_logs').add({
            channelId: message.channel.id,
            content: message.content,
            author: message.author.tag,
            timestamp: new Date()
        });
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.replied || interaction.deferred) return;
    const safeReply = async (data) => { if (!interaction.replied && !interaction.deferred) return await interaction.reply(data); };

    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;

        if (commandName === 'receive-notifications') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            await db.collection('subscribers').doc(interaction.user.id).set({ registeredAt: new Date() });
            return await interaction.editReply('通知の登録が完了しました！');
        }
        if (commandName === 'notice') {
            if (options.getString('password') !== process.env.ADMIN_PASSWORD) return await interaction.reply({ content: 'パスワードが違います。', flags: MessageFlags.Ephemeral });
            const modal = new ModalBuilder().setCustomId('notice_modal').setTitle('お知らせ内容入力');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('sender').setLabel('発信者名').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('タイトル').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('content').setLabel('内容').setStyle(TextInputStyle.Paragraph).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('url').setLabel('URL（任意）').setStyle(TextInputStyle.Short).setRequired(false))
            );
            try { await interaction.showModal(modal); } catch (e) { console.error(e); }
        }
        if (commandName === 'help') {
            const embed = new EmbedBuilder().setTitle('📜 コマンド一覧').setDescription('詳細を確認したいコマンドを選択してください。').setColor(0x00AE86);
            const select = new StringSelectMenuBuilder().setCustomId('help_select').setPlaceholder('コマンドを選択...').addOptions([
                { label: '/verify', value: 'help_verify' },
                { label: '/ticket', value: 'help_ticket' },
                { label: '/role-confirmation', value: 'help_role' },
                { label: '/delete', value: 'help_delete' },
                { label: '/give-role', value: 'help_giverole' },
                { label: '/remove-role', value: 'help_removerole' },
                { label: '/notice', value: 'help_notice' },
                { label: '/receive-notifications', value: 'help_notify' }
            ]);
            return await safeReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral });
        }
        if (commandName === 'delete') {
            const amount = options.getInteger('amount');
            const embed = new EmbedBuilder().setTitle('⚠️ 削除確認').setDescription(`本当に **${amount}件** 削除しますか？`).setColor(0xFF0000);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`bulk_delete_yes_${amount}`).setLabel('削除実行').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('bulk_delete_no').setLabel('キャンセル').setStyle(ButtonStyle.Secondary));
            return await safeReply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
        }
        if (commandName === 'verify') {
            const role = options.getRole('role');
            const embed = new EmbedBuilder().setTitle(options.getString('title') ?? '認証パネル').setDescription(options.getString('description') ?? 'ボタンを押してロールを取得してください。').setColor(0x3498DB);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`v_role_${role.id}`).setLabel('✅ 認証').setStyle(ButtonStyle.Success));
            return await safeReply({ embeds: [embed], components: [row] });
        }
        if (commandName === 'ticket') {
            const adminRole = options.getRole('admin-role');
            const key = `msg_${Date.now()}`;
            ticketMessages.set(key, options.getString('panel-desc') ?? 'チケットを発行しました。');
            const embed = new EmbedBuilder().setTitle(options.getString('title') ?? '問い合わせ').setDescription(options.getString('description') ?? 'チケットを発行します。').setColor(0x9B59B6);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`tkt_${adminRole.id}_${key}`).setLabel('🎫 チケット発行').setStyle(ButtonStyle.Primary));
            return await safeReply({ embeds: [embed], components: [row] });
        }
        if (commandName === 'role-confirmation') {
            const member = await interaction.guild.members.fetch(options.getUser('target').id).catch(() => null);
            const roles = member.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).join('\n') || 'なし';
            return await safeReply({ content: `ロール一覧:\n\`\`\`\n${roles}\n\`\`\``, flags: MessageFlags.Ephemeral });
        }
        if (commandName === 'give-role' || commandName === 'remove-role') {
            const role = options.getRole('role');
            const targets = ['target1', 'target2', 'target3', 'target4', 'target5'];
            let count = 0;
            for (const t of targets) {
                const user = options.getUser(t);
                if (user) {
                    try {
                        const member = await interaction.guild.members.fetch(user.id);
                        if (commandName === 'give-role') await member.roles.add(role);
                        else await member.roles.remove(role);
                        count++;
                    } catch (err) { console.error(`処理失敗: ${user.tag}`, err); }
                }
            }
            return await safeReply({ content: `${count} 名に対してロールの${commandName === 'give-role' ? '付与' : '剥奪'}が完了しました。`, flags: MessageFlags.Ephemeral });
        }
        if (commandName === 'set-vc-log-channel') {
            const channel = options.getChannel('channel');
            await db.collection('settings').doc(interaction.guild.id).set({ vcLogChannel: channel.id }, { merge: true });
            return await safeReply({ content: `ログ送信先を ${channel} に設定しました。`, flags: MessageFlags.Ephemeral });
        }
        if (commandName === 'record-vc-log') {
            const settings = await db.collection('settings').doc(interaction.guild.id).get();
            const logChannelId = settings.data()?.vcLogChannel;
            if (!logChannelId) return await safeReply({ content: '先に /set-vc-log-channel でチャンネルを設定してください。', flags: MessageFlags.Ephemeral });
            const logChannel = await interaction.guild.channels.fetch(logChannelId);
            const member = await interaction.guild.members.fetch(interaction.user.id);
            const vc = member.voice.channel;
            if (!vc) return await safeReply({ content: 'ボイスチャンネルに参加してください。', flags: MessageFlags.Ephemeral });
            const members = vc.members.map(m => m.displayName).join(', ');
            const date = new Date().toLocaleString('ja-JP');
            const embed = new EmbedBuilder().setTitle('🎙️ ボイスチャット参加ログ').addFields({ name: '日時', value: date }, { name: '場所', value: vc.name }, { name: '参加メンバー', value: members || 'なし' }).setColor(0x00FF00);
            await logChannel.send({ embeds: [embed] });
            return await safeReply({ content: `ログを ${logChannel} に送信しました。`, flags: MessageFlags.Ephemeral });
        }
        if (commandName === 'set-text-log-channel') {
            const channel = options.getChannel('channel');
            await db.collection('settings').doc(interaction.guild.id).set({ textLogChannel: channel.id }, { merge: true });
            return await safeReply({ content: `テキストログ送信先を ${channel} に設定しました。`, flags: MessageFlags.Ephemeral });
        }
        if (commandName === 'register-text-log') {
            await db.collection('text_logs_config').doc(interaction.channel.id).set({ registeredAt: new Date() });
            return await safeReply({ content: `このチャンネルをログ監視対象に登録しました。`, flags: MessageFlags.Ephemeral });
        }
    } else if (interaction.isModalSubmit() && interaction.customId === 'notice_modal') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const embed = new EmbedBuilder().setTitle(`📢 ${interaction.fields.getTextInputValue('title')}`).setDescription(`${interaction.fields.getTextInputValue('content')}\n\n${interaction.fields.getTextInputValue('url') ? `🔗 [詳細はこちら](${interaction.fields.getTextInputValue('url')})` : ''}`).setFooter({ text: `発信者: ${interaction.fields.getTextInputValue('sender')}` }).setColor(0x00FF00);
        const subs = await db.collection('subscribers').get();
        let count = 0;
        for (const doc of subs.docs) { try { const user = await client.users.fetch(doc.id); await user.send({ embeds: [embed] }); count++; } catch (e) { } }
        return await interaction.editReply(`${count} 名に送信しました。`);
    } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
        const { customId } = interaction;
        if (customId.startsWith('bulk_delete_yes_')) {
            await interaction.channel.bulkDelete(parseInt(customId.split('_')[3]), true);
            return await interaction.update({ content: '削除しました。', embeds: [], components: [] });
        }
        if (customId === 'bulk_delete_no') return await interaction.update({ content: 'キャンセルしました。', embeds: [], components: [] });
        if (customId.startsWith('v_role_')) {
            await interaction.member.roles.add(customId.split('_')[2]);
            return await safeReply({ content: 'ロールを付与しました！', flags: MessageFlags.Ephemeral });
        }
        if (customId.startsWith('tkt_')) {
            const [_, adminId, key] = customId.split('_');
            const customMessage = ticketMessages.get(key) || 'お問い合わせありがとうございます。\n担当者が来るまで少々お待ちください。';
            const ch = await interaction.guild.channels.create({ name: `🎫-${interaction.user.username}`, type: ChannelType.GuildText });
            await ch.send({ content: `${interaction.user} ${customMessage} <@&${adminId}>`, components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('t_close_c').setLabel('閉じる').setStyle(ButtonStyle.Danger))] });
            return await safeReply({ content: `チケットを作成しました: ${ch}`, flags: MessageFlags.Ephemeral });
        }
        if (customId === 't_close_c') {
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('t_yes').setLabel('削除').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('t_no').setLabel('キャンセル').setStyle(ButtonStyle.Secondary));
            return await interaction.reply({ content: '本当にチケットを削除しますか？', components: [row], flags: MessageFlags.Ephemeral });
        }
        if (customId === 't_no') return await interaction.update({ content: '削除をキャンセルしました。', components: [] });
        if (customId === 't_yes') await interaction.channel.delete();
        if (customId === 'help_select') {
            const helpData = {
                help_verify: { title: '/verify', desc: '【内容】認証パネルを作成します。\n【詳細】ボタンを押したユーザーに指定したロールを付与します。' },
                help_ticket: { title: '/ticket', desc: '【内容】チケットパネルを作成します。\n【詳細】問い合わせチャンネルを生成し、管理者へ通知します。' },
                help_role: { title: '/role-confirmation', desc: '【内容】ロール確認\n【詳細】指定した対象の現在のロール一覧を表示します。' },
                help_delete: { title: '/delete', desc: '【内容】メッセージ一括削除\n【詳細】指定した件数(1-100)のメッセージを削除します。' },
                help_giverole: { title: '/give-role', desc: '【内容】ロール付与\n【詳細】指定したユーザーに特定のロールを付与します。' },
                help_removerole: { title: '/remove-role', desc: '【内容】ロール剥奪\n【詳細】指定したユーザーから特定のロールを剥奪します。' },
                help_notice: { title: '/notice', desc: '【内容】お知らせ送信\n【詳細】パスワード認証後、通知登録者全員に一斉DMを送信します。' },
                help_notify: { title: '/receive-notifications', desc: '【内容】通知登録\n【詳細】お知らせを受け取るためのリストに自身を登録します。' }
            };
            const data = helpData[interaction.values[0]];
            await interaction.update({ embeds: [new EmbedBuilder().setTitle(`📖 ${data.title}`).setDescription(data.desc).setColor(0x00AE86)], components: [interaction.message.components[0]] });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
