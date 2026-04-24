const { 
    Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelType, PermissionsBitField, StringSelectMenuBuilder, 
    ActivityType, MessageFlags 
} = require('discord.js');
const express = require('express');
const admin = require('firebase-admin'); // ★追加

// --- 1. Firebaseの初期化 ---
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT.trim());
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("✅ Firebase initialized successfully!");
    } catch (e) {
        console.error("❌ Firebase initialization failed:", e);
    }
}
const db = admin.firestore(); // データベース操作用

// --- 2. Botの初期化 ---
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

const ticketMessages = new Map();

const activities = [
    "JYRAC公式Instはこちら！▶https://www.instagram.com/jyrac_official/",
    "NSF公式Instはこちら！▶https://www.instagram.com/2024nsfproject/",
    "ボットに関するお問い合わせはDisID’pitayakun7’まで",
    "広告募集中1",
    "広告募集中2",
];
const intervalSeconds = 15;

// --- 3. スラッシュコマンド定義 ---
const commands = [
    new SlashCommandBuilder().setName('verify').setDescription('認証パネルを作成します')
        .addRoleOption(o => o.setName('role').setDescription('付与するロール').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(false))
        .addStringOption(o => o.setName('description').setDescription('説明文').setRequired(false))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles),
    
    new SlashCommandBuilder().setName('ticket').setDescription('チケットパネルを作成します')
        .addRoleOption(o => o.setName('admin-role').setDescription('管理者ロール').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(false))
        .addStringOption(o => o.setName('description').setDescription('説明文').setRequired(false))
        .addStringOption(o => o.setName('panel-desc').setDescription('チケット発行後のメッセージ').setRequired(false))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),
    
    new SlashCommandBuilder().setName('role-confirmation').setDescription('メンバーの付与ロールを確認します')
        .addUserOption(o => o.setName('target').setDescription('対象のメンバー').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers),
    
    new SlashCommandBuilder().setName('delete').setDescription('メッセージを指定数削除します（二段階確認）')
        .addIntegerOption(o => o.setName('amount').setDescription('削除する数 (1-100)').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages),
    
    new SlashCommandBuilder().setName('help').setDescription('コマンドの詳細パネルを表示します')
         .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles),

    new SlashCommandBuilder().setName('give-role').setDescription('指定したメンバーにロールを付与します')
        .addUserOption(o => o.setName('target').setDescription('対象のメンバー').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('付与するロール').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles),

    new SlashCommandBuilder().setName('remove-role').setDescription('指定したメンバーからロールを剥奪します')
        .addUserOption(o => o.setName('target').setDescription('対象のメンバー').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('剥奪するロール').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles),

    // ★追加：ボット管理者追加コマンド
    new SlashCommandBuilder().setName('admin-add').setDescription('ボット管理者にユーザーを追加します')
        .addUserOption(o => o.setName('target').setDescription('追加するユーザー').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    // ★追加：ボット管理者削除コマンド
    new SlashCommandBuilder().setName('admin-remove').setDescription('ボット管理者からユーザーを削除します')
        .addUserOption(o => o.setName('target').setDescription('削除するユーザー').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

].map(c => {
    const json = c.toJSON();
    json.integration_types = [0, 1]; 
    json.contexts = [0, 1, 2];        
    return json;
});

// --- 4. 起動時処理 ---
client.once('ready', async () => {
    console.log(`${client.user.tag} 起動完了！`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Discord APIへのコマンド登録が完了しました！');
    } catch (error) {
        console.error('コマンド登録エラー:', error);
    }

    let i = 0;
    setInterval(() => {
        client.user.setActivity(activities[i], { type: ActivityType.Custom });
        i = (i + 1) % activities.length;
    }, intervalSeconds * 1000);
});

const app = express();
app.get('/', (req, res) => res.send('Bot is Active!'));
app.listen(3000);

// --- 5. メインロジック ---
client.on('interactionCreate', async interaction => {
    if (interaction.replied || interaction.deferred) return;

    const ephemeralReply = (content, options = {}) => interaction.reply({ ...options, content, flags: MessageFlags.Ephemeral });
    const ephemeralUpdate = (content, options = {}) => interaction.update({ ...options, content, flags: MessageFlags.Ephemeral, embeds: [], components: [] });

    // --- 【権限チェック】 ---
    if (interaction.guild && (interaction.isChatInputCommand() || (interaction.isButton() && (interaction.customId.startsWith('bulk_delete_yes') || interaction.customId === 't_yes')))) {
        
        const botMember = interaction.guild.members.me;
        const executor = interaction.member;

        // Firestoreから管理者データを取得
        const adminDoc = await db.collection('bot_admins').doc(executor.id).get();
        const isBotAdmin = adminDoc.exists;

        const isOwner = executor.id === interaction.guild.ownerId;
        const hasHigherRole = executor.roles.highest.position > botMember.roles.highest.position;

        if (!isOwner && !isBotAdmin && !hasHigherRole) {
            return ephemeralReply("お持ちのロールに使用権限がない、またはボット管理者ではありません。");
        }
    }

    // スラッシュコマンド処理
    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;
        
        // ★【admin-add】修正：deferReplyを導入
        if (commandName === 'admin-add') {
            const target = options.getUser('target');
            // まず「保留」する
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                await db.collection('bot_admins').doc(target.id).set({
                    username: target.tag,
                    addedAt: new Date()
                });
                // 保留していた返信を書き換える
                return await interaction.editReply(`✅ ${target.tag} をボット管理者に登録しました！`);
            } catch (error) {
                console.error(error);
                return await interaction.editReply("❌ データベース登録中にエラーが発生しました。");
            }
        }

        // ★【admin-remove】修正：deferReplyを導入
        if (commandName === 'admin-remove') {
            const target = options.getUser('target');
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                await db.collection('bot_admins').doc(target.id).delete();
                return await interaction.editReply(`🗑️ ${target.tag} をボット管理者から解除しました。`);
            } catch (error) {
                console.error(error);
                return await interaction.editReply("❌ データベース削除中にエラーが発生しました。");
            }
        }

        // --- 既存のコマンド群 ---
        if (commandName === 'help') {
            const embed = new EmbedBuilder().setTitle('📜 コマンドヘルプ').setDescription('詳細を確認したいコマンドを選択してください。').setColor(0x00AE86);
            const select = new StringSelectMenuBuilder().setCustomId('help_select').setPlaceholder('選択...')
                .addOptions(
                    { label: '/verify', value: 'help_verify' },
                    { label: '/ticket', value: 'help_ticket' },
                    { label: '/role-confirmation', value: 'help_role' },
                    { label: '/delete', value: 'help_delete' }
                );
            await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral });
        }
        
        if (commandName === 'delete') {
            const amount = options.getInteger('amount');
            if (amount < 1 || amount > 100) return ephemeralReply('1〜100の間で指定してください。');
            const messages = await interaction.channel.messages.fetch({ limit: 1 });
            const lastMsg = messages.first();
            let msgDetails = "確認不可。";
            if (lastMsg) {
                const link = `https://discord.com/channels/${interaction.guildId}/${interaction.channelId}/${lastMsg.id}`;
                msgDetails = `**発言者:** ${lastMsg.author.tag}\n**内容:** ${lastMsg.content.substring(0, 50) || "（画像等）"}\n**リンク:** [移動](${link})`;
            }
            const embed = new EmbedBuilder().setTitle('⚠️テキスト削除確認').setDescription(`本当に **${amount}件** 削除しますか？\n\n${msgDetails}`).setColor(0xFF0000);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`bulk_delete_yes_${amount}`).setLabel('削除実行').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('bulk_delete_no').setLabel('キャンセル').setStyle(ButtonStyle.Secondary)
            );
            await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
        }
        
        if (commandName === 'verify') {
            const role = options.getRole('role');
            const embed = new EmbedBuilder().setTitle(options.getString('title') ?? 'ロール付与').setDescription(options.getString('description') ?? 'ボタンを押して取得。').setColor(0x3498DB);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`v_role_${role.id}`).setLabel('✅ 認証').setStyle(ButtonStyle.Success));
            await interaction.reply({ embeds: [embed], components: [row] });
        }
        
        if (commandName === 'ticket') {
            const adminRole = options.getRole('admin-role');
            const messageKey = `msg_${Date.now()}`;
            ticketMessages.set(messageKey, options.getString('panel-desc') ?? 'チケットを発行しました。');
            const embed = new EmbedBuilder().setTitle(options.getString('title') ?? '問い合わせ').setDescription(options.getString('description') ?? '以下のボタンでチケットを発行することができます。').setColor(0x9B59B6);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`tkt_${adminRole.id}_${messageKey}`).setLabel('🎫 発行').setStyle(ButtonStyle.Primary));
            await interaction.reply({ embeds: [embed], components: [row] });
        }
        
        if (commandName === 'role-confirmation') {
            const target = options.getUser('target');
            const member = await interaction.guild.members.fetch(target.id).catch(() => null);
            if (!member) return ephemeralReply('取得失敗');
            const roles = member.roles.cache.filter(r => r.name !== '@everyone').sort((a,b) => b.position - a.position).map(r => r.name).join('\n') || 'なし';
            await ephemeralReply(`**${member.user.tag}** のロール:\n\`\`\`\n${roles}\n\`\`\``);
        }

        if (commandName === 'give-role') {
            const targetMember = options.getMember('target');
            const role = options.getRole('role');
            if (role.position >= interaction.guild.members.me.roles.highest.position) {
                return ephemeralReply('❌ 指定されたロールはBotの最高権限ロールよりも高いため付与できません。');
            }
            try {
                await targetMember.roles.add(role);
                await interaction.reply({ content: `✅ ${targetMember.user.tag} に ${role.name} を付与しました！`, ephemeral: true });
            } catch (error) {
                console.error(error);
                await ephemeralReply('❌ ロールの付与に失敗しました。');
            }
        }

        if (commandName === 'remove-role') {
            const targetMember = options.getMember('target');
            const role = options.getRole('role');
            if (role.position >= interaction.guild.members.me.roles.highest.position) {
                return ephemeralReply('❌ 指定されたロールはBotの最高権限ロールよりも高いため剥奪できません。');
            }
            if (!targetMember.roles.cache.has(role.id)) {
                return ephemeralReply(`❌ ${targetMember.user.tag} はそのロールを持っていません。`);
            }
            try {
                await targetMember.roles.remove(role);
                await interaction.reply({ content: `✅ ${targetMember.user.tag} から ${role.name} を剥奪しました！`, ephemeral: true });
            } catch (error) {
                console.error(error);
                await ephemeralReply('❌ ロールの剥奪に失敗しました。');
            }
        }
    }

    // メニュー・ボタン操作
    if (interaction.isStringSelectMenu() && interaction.customId === 'help_select') {
        const h = {
            help_verify: { title: "/verify", description: "設定したロールを付与することができます。" },
            help_ticket: { title: "/ticket", description: "チケットを作成して、管理者に問い合わせることができます。" },
            help_role: { title: "/role-confirmation", description: "指定したメンバーのロールを確認できます。" },
            help_delete: { title: "/delete", description: "一括削除。最新メッセージのリンク確認付使用したチャンネル内のチャットを指定の数だけ消すことができます。" }
        };
        const selected = h[interaction.values[0]];
        const embed = new EmbedBuilder().setTitle(`📜 ${selected.title}`).setDescription(selected.description).setColor(0x00AE86);
        await interaction.update({ content: null, embeds: [embed], components: [interaction.message.components[0]] });
    }

    if (interaction.isButton()) {
        if (interaction.customId.startsWith('bulk_delete_yes_')) {
            const amount = parseInt(interaction.customId.split('_')[3]);
            await interaction.channel.bulkDelete(amount, true)
                .then(m => ephemeralUpdate(`✅ ${m.size}件削除しました。`))
                .catch(() => ephemeralUpdate("❌ 14日以上前のは削除不可。"));
        }
        if (interaction.customId === 'bulk_delete_no') await ephemeralUpdate('キャンセル。');

        if (interaction.customId.startsWith('v_role_')) {
            const roleId = interaction.customId.split('_')[2];
            try {
                await interaction.member.roles.add(roleId);
                await ephemeralReply('付与完了！');
            } catch (error) {
                await ephemeralReply('❌ ロールの付与に失敗しました。Botの権限またはロールの順位を確認してください。');
            }
        }

        if (interaction.customId.startsWith('tkt_')) {
            const [_, adminId, key] = interaction.customId.split('_');
            const desc = ticketMessages.get(key) ?? '以下のロールの担当者が来るまでお待ちください。';
            const channel = await interaction.guild.channels.create({
                name: `🎫｜${interaction.user.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                    { id: adminId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                ]
            });
            const btn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('t_close_c').setLabel('チケットを閉じる').setStyle(ButtonStyle.Danger));
            await channel.send({ content: `${interaction.user} 様\n${desc}\n\n<@&${adminId}>`, components: [btn] });
            await ephemeralReply(`チケット作成: ${channel}`);
        }

        if (interaction.customId === 't_close_c') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('t_yes').setLabel('削除する').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('t_no').setLabel('キャンセル').setStyle(ButtonStyle.Secondary)
            );
            await ephemeralReply('本当に、削除しますか？', { components: [row] });
        }

        if (interaction.customId === 't_yes') {
            await interaction.channel.delete().catch(() => {});
        }
        if (interaction.customId === 't_no') {
            await ephemeralUpdate('削除をキャンセルしました。');
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
