const {
    Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField,
    StringSelectMenuBuilder, ActivityType, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const express = require('express');
const admin = require('firebase-admin');

// --- 0. Firebase初期化 ---
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// --- 1. Botの初期化 ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

const ticketMessages = new Map();
const activities = [
    "JYRAC公式Instaはこちら！▶https://www.instagram.com/jyrac_official/",
    "NSF公式Instaはこちら！▶https://www.instagram.com/2024nsfproject/",
    "ボットに関するお問い合わせはDiscordID’pitayakun7’まで",
    "①広告募集中",
    "②広告募集中"
];

// --- 2. スラッシュコマンド定義 ---
const commands = [
    new SlashCommandBuilder().setName('verify').setDescription('認証パネルを作成')
        .addRoleOption(o => o.setName('role').setDescription('付与するロール').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('パネルのタイトル'))
        .addStringOption(o => o.setName('description').setDescription('パネルの説明文'))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles),
    
    new SlashCommandBuilder().setName('ticket').setDescription('チケットパネルを作成')
        .addRoleOption(o => o.setName('admin-role').setDescription('対応する管理ロール').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('パネルのタイトル'))
        .addStringOption(o => o.setName('description').setDescription('パネルの説明文'))
        .addStringOption(o => o.setName('panel-desc').setDescription('チケット作成時のメッセージ'))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),
    
    new SlashCommandBuilder().setName('role-confirmation').setDescription('ロール確認')
        .addUserOption(o => o.setName('target').setDescription('対象のユーザー').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers),
    
    new SlashCommandBuilder().setName('delete').setDescription('メッセージ削除')
        .addIntegerOption(o => o.setName('amount').setDescription('削除する件数(1-100)').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages),
    
    new SlashCommandBuilder().setName('help').setDescription('ヘルプを表示'),
    
    new SlashCommandBuilder().setName('give-role').setDescription('ロール付与')
        .addUserOption(o => o.setName('target').setDescription('対象のユーザー').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('付与するロール').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles),
    
    new SlashCommandBuilder().setName('remove-role').setDescription('ロール剥奪')
        .addUserOption(o => o.setName('target').setDescription('対象のユーザー').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('剥奪するロール').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles),
    new SlashCommandBuilder().setName('receive-notifications').setDescription('通知登録'),
    
   new SlashCommandBuilder().setName('notice').setDescription('お知らせ送信')
    .addStringOption(o => o.setName('password').setDescription('パスワード').setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles)
].map(c => c.toJSON());

// --- 3. 起動時処理 ---
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

// --- 4. メインロジック ---
client.on('interactionCreate', async interaction => {
    if (interaction.replied || interaction.deferred) return;

    const safeReply = async (data) => {
        if (!interaction.replied && !interaction.deferred) {
            return await interaction.reply(data);
        }
    };

    // 1. スラッシュコマンド
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'receive-notifications') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            await db.collection('subscribers').doc(interaction.user.id).set({ registeredAt: new Date() });
            return await interaction.editReply('通知の登録が完了しました！');
        }
        if (interaction.commandName === 'notice') {
            const inputPassword = interaction.options.getString('password');

            // パスワードチェック：合っていなければ即座に終了
            if (inputPassword !== process.env.ADMIN_PASSWORD) {
                return await interaction.reply({ content: 'パスワードが違います。', flags: MessageFlags.Ephemeral });
            }

            // 合っていれば、いきなり「お知らせ入力用」のモーダルを出す
            const modal = new ModalBuilder().setCustomId('notice_modal').setTitle('お知らせ内容入力');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('sender').setLabel('発信者名').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('タイトル').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('content').setLabel('内容').setStyle(TextInputStyle.Paragraph).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('url').setLabel('URL（任意）').setStyle(TextInputStyle.Short).setRequired(false))
            );
            return await interaction.showModal(modal);
        }
        if (interaction.commandName === 'help') {
            const embed = new EmbedBuilder().setTitle('📜 コマンドヘルプ').setDescription('詳細を確認したいコマンドを選択してください。').setColor(0x00AE86);
            const select = new StringSelectMenuBuilder().setCustomId('help_select').setPlaceholder('選択...')
                .addOptions([{ label: '/verify', value: 'help_verify' }, { label: '/ticket', value: 'help_ticket' }, { label: '/role-confirmation', value: 'help_role' }, { label: '/delete', value: 'help_delete' }]);
            return await safeReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral });
        }
        if (interaction.commandName === 'delete') {
            const amount = interaction.options.getInteger('amount');
            if (amount < 1 || amount > 100) return await safeReply({ content: '1〜100の間で指定してください。', flags: MessageFlags.Ephemeral });
            const embed = new EmbedBuilder().setTitle('⚠️テキスト削除確認').setDescription(`本当に **${amount}件** 削除しますか？`).setColor(0xFF0000);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`bulk_delete_yes_${amount}`).setLabel('削除実行').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('bulk_delete_no').setLabel('キャンセル').setStyle(ButtonStyle.Secondary)
            );
            return await safeReply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
        }
        if (interaction.commandName === 'verify') {
            const role = interaction.options.getRole('role');
            const embed = new EmbedBuilder().setTitle(interaction.options.getString('title') ?? 'ロール付与').setDescription(interaction.options.getString('description') ?? 'ボタンを押して取得。').setColor(0x3498DB);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`v_role_${role.id}`).setLabel('✅ 認証').setStyle(ButtonStyle.Success));
            return await safeReply({ embeds: [embed], components: [row] });
        }
        if (interaction.commandName === 'ticket') {
            const adminRole = interaction.options.getRole('admin-role');
            const key = `msg_${Date.now()}`;
            ticketMessages.set(key, interaction.options.getString('panel-desc') ?? 'チケットを発行しました。');
            const embed = new EmbedBuilder().setTitle(interaction.options.getString('title') ?? '問い合わせ').setDescription(interaction.options.getString('description') ?? 'チケットを発行します。').setColor(0x9B59B6);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`tkt_${adminRole.id}_${key}`).setLabel('🎫 発行').setStyle(ButtonStyle.Primary));
            return await safeReply({ embeds: [embed], components: [row] });
        }
        if (interaction.commandName === 'role-confirmation') {
            const member = await interaction.guild.members.fetch(interaction.options.getUser('target').id).catch(() => null);
            if (!member) return await safeReply({ content: '取得失敗', flags: MessageFlags.Ephemeral });
            const roles = member.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).join('\n') || 'なし';
            return await safeReply({ content: `ロール:\n\`\`\`\n${roles}\n\`\`\``, flags: MessageFlags.Ephemeral });
        }
        if (['give-role', 'remove-role'].includes(interaction.commandName)) {
            const member = interaction.options.getMember('target');
            const role = interaction.options.getRole('role');
            if (interaction.commandName === 'give-role') await member.roles.add(role);
            else await member.roles.remove(role);
            return await safeReply({ content: '処理完了！', flags: MessageFlags.Ephemeral });
        }
    }

    // 2. モーダル処理
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'notice_modal') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const title = interaction.fields.getTextInputValue('title');
            const content = interaction.fields.getTextInputValue('content');
            const url = interaction.fields.getTextInputValue('url');
            const sender = interaction.fields.getTextInputValue('sender');
            const embed = new EmbedBuilder().setTitle(`📢 ${title}`).setDescription(`${content}\n\n${url ? `🔗 [詳細はこちら](${url})` : ''}`).setFooter({ text: `発信者: ${sender}` }).setColor(0x00FF00);
            const subs = await db.collection('subscribers').get();
            let successCount = 0;
            for (const doc of subs.docs) {
                try {
                    const user = await client.users.fetch(doc.id);
                    await user.send({ embeds: [embed] });
                    successCount++;
                } catch (e) { console.log(`送信失敗: ${doc.id}`); }
            }
            return await interaction.editReply(`お知らせを ${successCount} 名に送信しました。`);
        }
    }

    // 3. ボタン・メニュー
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith('bulk_delete_yes_')) {
            await interaction.channel.bulkDelete(parseInt(interaction.customId.split('_')[3]), true);
            return await interaction.update({ content: '削除完了', embeds: [], components: [] });
        }
        if (interaction.customId.startsWith('v_role_')) {
            await interaction.member.roles.add(interaction.customId.split('_')[2]);
            return await safeReply({ content: '付与完了！', flags: MessageFlags.Ephemeral });
        }
        if (interaction.customId.startsWith('tkt_')) {
            const [_, adminId, key] = interaction.customId.split('_');
            const ch = await interaction.guild.channels.create({ name: `🎫-${interaction.user.username}`, type: ChannelType.GuildText });
            await ch.send({ content: `${interaction.user} ${ticketMessages.get(key) || ''} <@&${adminId}>`, components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('t_close_c').setLabel('閉じる').setStyle(ButtonStyle.Danger))] });
            return await safeReply({ content: `作成: ${ch}`, flags: MessageFlags.Ephemeral });
        }
        if (interaction.customId === 't_close_c') {
            await safeReply({ components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('t_yes').setLabel('削除').setStyle(ButtonStyle.Danger))], flags: MessageFlags.Ephemeral });
        }
        if (interaction.customId === 't_yes') await interaction.channel.delete();
        if (interaction.customId === 'help_select') {
            const h = { help_verify: 'ロール付与', help_ticket: 'チケット作成', help_role: 'ロール確認', help_delete: '一括削除' };
            await interaction.update({ embeds: [new EmbedBuilder().setTitle(h[interaction.values[0]]).setColor(0x00AE86)], components: [interaction.message.components[0]] });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
