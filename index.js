const { 
    Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelType, PermissionsBitField, StringSelectMenuBuilder, 
    ActivityType, MessageFlags 
} = require('discord.js');
const express = require('express');
const admin = require('firebase-admin');

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
const db = admin.firestore();

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
        .addRoleOption(o => o.setName('admin-role').setDescription('メンションされるロールを指定できます。').setRequired(true))
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

    new SlashCommandBuilder().setName('admin-add').setDescription('ボット管理者にユーザーを追加します')
        .addUserOption(o => o.setName('target').setDescription('追加するユーザー').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

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
    // 既に返信済みなら何もしない
    if (interaction.replied || interaction.deferred) return;

    // ★重要：何よりも先に deferReply を実行して Discord の「3秒ルール」を回避する
    // ただし、即座に返信（update）が必要なメニュー操作や、一部のボタンは除外
    const needsDefer = interaction.isChatInputCommand() || 
                       (interaction.isButton() && (interaction.customId.startsWith('bulk_delete_yes') || interaction.customId === 't_yes'));

    if (needsDefer) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        } catch (e) {
            console.error("DeferReply Error:", e);
            return;
        }
    }

    // --- 【権限チェック：最優先判定】 ---
    if (interaction.guild && needsDefer) {
        try {
            const botMember = interaction.guild.members.me;
            const executor = interaction.member;

            // Firestoreから管理者データを取得
            const adminDoc = await db.collection('bot_admins').doc(executor.id).get();
            const isBotAdmin = adminDoc.exists;
            const isOwner = executor.id === interaction.guild.ownerId;

            // 管理者でもオーナーでもない場合のみロール順位をチェック
            if (!isBotAdmin && !isOwner) {
                const hasHigherRole = executor.roles.highest.position > botMember.roles.highest.position;
                if (!hasHigherRole) {
                    return await interaction.editReply("❌ 権限がありません。");
                }
            }
        } catch (err) {
            console.error("Auth Check Error:", err);
            return await interaction.editReply("❌ 権限確認中にエラーが発生しました。");
        }
    }

    // スラッシュコマンド処理
    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;
        
        if (commandName === 'admin-add') {
            const target = options.getUser('target');
            try {
                await db.collection('bot_admins').doc(target.id).set({
                    username: target.username,
                    userId: target.id,
                    addedAt: new Date()
                });
                return await interaction.editReply(`✅ **${target.username}** を管理者に登録しました！`);
            } catch (error) {
                return await interaction.editReply("❌ 登録が失敗しました。");
            }
        }

        if (commandName === 'admin-remove') {
            const target = options.getUser('target');
            try {
                await db.collection('bot_admins').doc(target.id).delete();
                return await interaction.editReply(`🗑️ **${target.username}** を解除しました。`);
            } catch (error) {
                return await interaction.editReply("❌ 削除に失敗しました。");
            }
        }

        if (commandName === 'help') {
            const embed = new EmbedBuilder().setTitle('📜 ヘルプ').setDescription('メニューから選択してください。').setColor(0x00AE86);
            const select = new StringSelectMenuBuilder().setCustomId('help_select').setPlaceholder('選択...')
                .addOptions(
                    { label: '/verify', value: 'help_verify' },
                    { label: '/ticket', value: 'help_ticket' },
                    { label: '/role-confirmation', value: 'help_role' },
                    { label: '/delete', value: 'help_delete' }
                );
            return await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] });
        }
        
        if (commandName === 'delete') {
            const amount = options.getInteger('amount');
            const embed = new EmbedBuilder().setTitle('⚠️ 削除確認').setDescription(`本当に **${amount}件** 削除しますか？`).setColor(0xFF0000);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`bulk_delete_yes_${amount}`).setLabel('実行').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('bulk_delete_no').setLabel('中止').setStyle(ButtonStyle.Secondary)
            );
            return await interaction.editReply({ embeds: [embed], components: [row] });
        }
        
        if (commandName === 'verify') {
            const role = options.getRole('role');
            const embed = new EmbedBuilder().setTitle(options.getString('title') ?? '認証').setDescription(options.getString('description') ?? 'ボタンを押してください。').setColor(0x3498DB);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`v_role_${role.id}`).setLabel('✅ 認証').setStyle(ButtonStyle.Success));
            await interaction.deleteReply(); 
            return await interaction.channel.send({ embeds: [embed], components: [row] });
        }
        
        if (commandName === 'ticket') {
            const adminRole = options.getRole('admin-role');
            const messageKey = `msg_${Date.now()}`;
            ticketMessages.set(messageKey, options.getString('panel-desc') ?? 'チケットを作成しました。');
            const embed = new EmbedBuilder().setTitle(options.getString('title') ?? 'チケット').setDescription(options.getString('description') ?? '発行ボタンを押してください。').setColor(0x9B59B6);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`tkt_${adminRole.id}_${messageKey}`).setLabel('🎫 発行').setStyle(ButtonStyle.Primary));
            await interaction.deleteReply();
            return await interaction.channel.send({ embeds: [embed], components: [row] });
        }
        
        if (commandName === 'role-confirmation') {
            const target = options.getUser('target');
            const member = await interaction.guild.members.fetch(target.id).catch(() => null);
            if (!member) return await interaction.editReply('取得失敗');
            const roles = member.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).join('\n') || 'なし';
            return await interaction.editReply(`**${member.user.tag}** のロール:\n\`\`\`\n${roles}\n\`\`\``);
        }

        if (commandName === 'give-role') {
            const targetMember = options.getMember('target');
            const role = options.getRole('role');
            try {
                await targetMember.roles.add(role);
                return await interaction.editReply(`✅ 付与完了。`);
            } catch (e) {
                return await interaction.editReply('❌ エラーが発生しました。');
            }
        }

        if (commandName === 'remove-role') {
            const targetMember = options.getMember('target');
            const role = options.getRole('role');
            try {
                await targetMember.roles.remove(role);
                return await interaction.editReply(`✅ 剥奪完了。`);
            } catch (e) {
                return await interaction.editReply('❌ エラーが発生しました。');
            }
        }
    }

    // メニュー・ボタン操作
    if (interaction.isStringSelectMenu() && interaction.customId === 'help_select') {
        const h = {
            help_verify: { title: "/verify", description: "ロール付与パネルを作成します。" },
            help_ticket: { title: "/ticket", description: "問い合わせパネルを作成します。" },
            help_role: { title: "/role-confirmation", description: "ロール確認が行えます。" },
            help_delete: { title: "/delete", description: "メッセージ削除を行います。" }
        };
        const selected = h[interaction.values[0]];
        const embed = new EmbedBuilder().setTitle(`📜 ${selected.title}`).setDescription(selected.description).setColor(0x00AE86);
        // メニューはupdateを使うのでdefer不要
        await interaction.update({ embeds: [embed] });
    }

    if (interaction.isButton()) {
        if (interaction.customId.startsWith('bulk_delete_yes_')) {
            const amount = parseInt(interaction.customId.split('_')[3]);
            await interaction.channel.bulkDelete(amount, true)
                .then(m => interaction.editReply(`✅ ${m.size}件削除しました。`))
                .catch(() => interaction.editReply("❌ 削除失敗。"));
        }
        if (interaction.customId === 'bulk_delete_no') {
            await interaction.editReply('キャンセルしました。');
        }

        if (interaction.customId.startsWith('v_role_')) {
            const roleId = interaction.customId.split('_')[2];
            try {
                await interaction.member.roles.add(roleId);
                await interaction.reply({ content: '完了！', flags: MessageFlags.Ephemeral });
            } catch (e) {
                await interaction.reply({ content: '❌ 失敗。', flags: MessageFlags.Ephemeral });
            }
        }

        if (interaction.customId.startsWith('tkt_')) {
            const [_, adminId, key] = interaction.customId.split('_');
            const channel = await interaction.guild.channels.create({
                name: `🎫-${interaction.user.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                    { id: adminId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                ]
            });
            const btn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('t_close_c').setLabel('閉じる').setStyle(ButtonStyle.Danger));
            await channel.send({ content: `${interaction.user} チケットを作成しました。\n<@&${adminId}>`, components: [btn] });
            await interaction.reply({ content: `作成完了: ${channel}`, flags: MessageFlags.Ephemeral });
        }

        if (interaction.customId === 't_close_c') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('t_yes').setLabel('消去').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('t_no').setLabel('中止').setStyle(ButtonStyle.Secondary)
            );
            await interaction.reply({ content: '削除しますか？', components: [row], flags: MessageFlags.Ephemeral });
        }

        if (interaction.customId === 't_yes') {
            await interaction.channel.delete().catch(() => {});
        }
        if (interaction.customId === 't_no') {
            await interaction.update({ content: '中止しました。', components: [] });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
