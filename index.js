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
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
        }
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
        .addStringOption(o => o.setName('title').setDescription('パネルのタイトル').setRequired(false))
        .addStringOption(o => o.setName('description').setDescription('パネルの説明文').setRequired(false))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles),
    
    new SlashCommandBuilder().setName('ticket').setDescription('チケットパネルを作成します')
        .addRoleOption(o => o.setName('admin-role').setDescription('管理者ロール（チケットが見れる人）').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('パネルのタイトル').setRequired(false))
        .addStringOption(o => o.setName('description').setDescription('パネルの説明文').setRequired(false))
        .addStringOption(o => o.setName('panel-desc').setDescription('チケット発行後に表示される案内文').setRequired(false))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),
    
    new SlashCommandBuilder().setName('role-confirmation').setDescription('メンバーの付与ロールを確認します')
        .addUserOption(o => o.setName('target').setDescription('対象のメンバー').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers),
    
    new SlashCommandBuilder().setName('delete').setDescription('メッセージを指定数削除します（二段階確認付き）')
        .addIntegerOption(o => o.setName('amount').setDescription('削除する数 (1-100)').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages),
    
    new SlashCommandBuilder().setName('help').setDescription('全コマンドの詳細説明パネルを表示します'),

    new SlashCommandBuilder().setName('give-role').setDescription('指定したメンバーにロールを付与します')
        .addUserOption(o => o.setName('target').setDescription('対象のメンバー').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('付与するロール').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles),

    new SlashCommandBuilder().setName('remove-role').setDescription('指定したメンバーからロールを剥奪します')
        .addUserOption(o => o.setName('target').setDescription('対象のメンバー').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('剥奪するロール').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles),

    new SlashCommandBuilder().setName('admin-add').setDescription('ボット管理者にユーザーを追加します（Firebase）')
        .addUserOption(o => o.setName('target').setDescription('追加するユーザー').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    new SlashCommandBuilder().setName('admin-remove').setDescription('ボット管理者からユーザーを削除します（Firebase）')
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
        console.log('✅ Discord APIへのコマンド登録が完了しました！');
    } catch (error) {
        console.error('❌ コマンド登録エラー:', error);
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

    // --- Unknown Interaction対策：即座に応答を保留する ---
    if (interaction.isChatInputCommand()) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(console.error);
    } else if (interaction.isButton()) {
        if (interaction.customId.startsWith('bulk_delete_confirm_') || interaction.customId === 't_close_yes') {
            await interaction.deferUpdate().catch(console.error);
        }
    }

    // --- 【権限チェック】Firebase ID または Discordの特定権限(ManageChannels等) ---
    if (interaction.guild && interaction.isChatInputCommand()) {
        try {
            // Firebaseから取得
            const adminDoc = await db.collection('bot_admins').doc(interaction.user.id).get();
            const isBotAdmin = adminDoc.exists; // Firebaseに登録があるか
            
            // Discord側の権限（各コマンドで設定した代表的な権限をチェック）
            const hasDiscordPerms = 
                interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles) ||
                interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels) ||
                interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages) ||
                interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);

            // サーバーオーナー
            const isOwner = interaction.user.id === interaction.guild.ownerId;

            // 【判定ロジック】FirebaseにIDがある OR 元々のDiscord権限がある OR オーナー
            if (isBotAdmin || hasDiscordPerms || isOwner) {
                // 許可：そのまま下の処理へ進む
            } else {
                // 拒否：Firebaseにも登録がなく、Discordの権限（ロール）も足りない場合
                return await interaction.editReply("❌ お持ちのロールに使用権限がない、またはボット管理者として登録されていません。").catch(console.error);
            }
        } catch (e) {
            console.error("Database Auth Error:", e);
        }
    }

    // --- A. スラッシュコマンド処理 ---
    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;

        if (commandName === 'admin-add') {
            const target = options.getUser('target');
            await db.collection('bot_admins').doc(target.id).set({
                username: target.tag,
                userId: target.id,
                addedAt: new Date()
            });
            return await interaction.editReply(`✅ **${target.tag}** をボット管理者に登録しました。`).catch(console.error);
        }

        if (commandName === 'admin-remove') {
            const target = options.getUser('target');
            await db.collection('bot_admins').doc(target.id).delete();
            return await interaction.editReply(`🗑️ **${target.tag}** をボット管理者から解除しました。`).catch(console.error);
        }

        if (commandName === 'help') {
            const embed = new EmbedBuilder()
                .setTitle('📜 コマンドヘルプ')
                .setDescription('詳細を確認したいコマンドを選択してください。')
                .setColor(0x00AE86);
            const select = new StringSelectMenuBuilder().setCustomId('help_select').setPlaceholder('コマンドを選択...')
                .addOptions(
                    { label: '/verify', value: 'help_verify', description: '認証パネルの作成' },
                    { label: '/ticket', value: 'help_ticket', description: 'チケットシステムの設置' },
                    { label: '/role-confirmation', value: 'help_role', description: '所持ロールの確認' },
                    { label: '/delete', value: 'help_delete', description: 'メッセージ一括削除' }
                );
            const row = new ActionRowBuilder().addComponents(select);
            return await interaction.editReply({ embeds: [embed], components: [row] }).catch(console.error);
        }

        if (commandName === 'delete') {
            const amount = options.getInteger('amount');
            if (amount < 1 || amount > 100) return await interaction.editReply('1〜100の間で指定してください。');
            
            const messages = await interaction.channel.messages.fetch({ limit: 1 }).catch(() => null);
            const lastMsg = messages?.first();
            let msgDetails = lastMsg ? `**発言者:** ${lastMsg.author.tag}\n**内容:** ${lastMsg.content.substring(0, 50) || "（画像等）"}` : "確認不可。";
            
            const embed = new EmbedBuilder()
                .setTitle('⚠️ 削除確認')
                .setDescription(`本当に **${amount}件** 削除しますか？\n\n${msgDetails}`)
                .setColor(0xFF0000);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`bulk_delete_confirm_${amount}`).setLabel('削除実行').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('bulk_delete_cancel').setLabel('キャンセル').setStyle(ButtonStyle.Secondary)
            );
            return await interaction.editReply({ embeds: [embed], components: [row] }).catch(console.error);
        }

        if (commandName === 'verify') {
            const role = options.getRole('role');
            const title = options.getString('title') ?? 'ロール認証';
            const desc = options.getString('description') ?? '下のボタンを押してロールを受け取ってください。';
            const embed = new EmbedBuilder().setTitle(title).setDescription(desc).setColor(0x3498DB);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`v_role_${role.id}`).setLabel('✅ 認証').setStyle(ButtonStyle.Success)
            );
            await interaction.deleteReply().catch(() => {});
            return await interaction.channel.send({ embeds: [embed], components: [row] }).catch(console.error);
        }

        if (commandName === 'ticket') {
            const adminRole = options.getRole('admin-role');
            const messageKey = `msg_${Date.now()}`;
            const panelDesc = options.getString('panel-desc') ?? '担当者が来るまでお待ちください。';
            ticketMessages.set(messageKey, panelDesc);

            const embed = new EmbedBuilder()
                .setTitle(options.getString('title') ?? 'チケット発行')
                .setDescription(options.getString('description') ?? 'お問い合わせは下のボタンから。')
                .setColor(0x9B59B6);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`tkt_${adminRole.id}_${messageKey}`).setLabel('🎫 チケット作成').setStyle(ButtonStyle.Primary)
            );
            await interaction.deleteReply().catch(() => {});
            return await interaction.channel.send({ embeds: [embed], components: [row] }).catch(console.error);
        }

        if (commandName === 'role-confirmation') {
            const target = options.getUser('target');
            const member = await interaction.guild.members.fetch(target.id).catch(() => null);
            if (!member) return await interaction.editReply('メンバー情報の取得に失敗しました。');
            const roles = member.roles.cache.filter(r => r.name !== '@everyone').sort((a,b) => b.position - a.position).map(r => r.name).join('\n') || 'なし';
            return await interaction.editReply(`**${member.user.tag}** の所持ロール:\n\`\`\`\n${roles}\n\`\`\``).catch(console.error);
        }

        if (commandName === 'give-role' || commandName === 'remove-role') {
            const targetMember = options.getMember('target');
            const role = options.getRole('role');
            if (role.position >= interaction.guild.members.me.roles.highest.position) {
                return await interaction.editReply('❌ 指定されたロールはBotの最高権限ロールよりも高いため操作できません。').catch(console.error);
            }
            try {
                if (commandName === 'give-role') await targetMember.roles.add(role);
                else await targetMember.roles.remove(role);
                return await interaction.editReply(`✅ ${targetMember.user.tag} に対するロール操作を完了しました。`).catch(console.error);
            } catch (e) {
                return await interaction.editReply('❌ ロール操作に失敗しました。権限を確認してください。').catch(console.error);
            }
        }
    }

    // --- B. メニュー・ボタン処理 ---
    if (interaction.isStringSelectMenu() && interaction.customId === 'help_select') {
        const helpData = {
            help_verify: "認証ボタン付きのパネルを設置します。押した人に指定ロールを付与します。",
            help_ticket: "お問い合わせチケットを作成するパネルを設置します。専用チャンネルが作成されます。",
            help_role: "指定したユーザーが現在持っているロールを一覧で表示します。",
            help_delete: "メッセージを指定数削除します。最新メッセージの確認画面が出ます。"
        };
        const embed = new EmbedBuilder()
            .setTitle(`📜 詳細説明`)
            .setDescription(helpData[interaction.values[0]])
            .setColor(0x00AE86);
        return await interaction.update({ embeds: [embed] }).catch(console.error);
    }

    if (interaction.isButton()) {
        const cid = interaction.customId;

        if (cid.startsWith('bulk_delete_confirm_')) {
            const amount = parseInt(cid.split('_')[3]);
            await interaction.channel.bulkDelete(amount, true)
                .then(m => interaction.followUp({ content: `✅ ${m.size}件のメッセージを削除しました。`, flags: MessageFlags.Ephemeral }))
                .catch(() => interaction.followUp({ content: "❌ 14日以上前のメッセージは一括削除できません。", flags: MessageFlags.Ephemeral }));
            return;
        }

        if (cid === 'bulk_delete_cancel') {
            return await interaction.reply({ content: '削除をキャンセルしました。', flags: MessageFlags.Ephemeral }).catch(console.error);
        }

        if (cid.startsWith('v_role_')) {
            const roleId = cid.split('_')[2];
            try {
                await interaction.member.roles.add(roleId);
                return await interaction.reply({ content: '✅ ロールを付与しました！', flags: MessageFlags.Ephemeral });
            } catch (e) {
                return await interaction.reply({ content: '❌ 権限エラー：Botのロール順位を確認してください。', flags: MessageFlags.Ephemeral });
            }
        }

        if (cid.startsWith('tkt_')) {
            const [_, adminId, key] = cid.split('_');
            const desc = ticketMessages.get(key) ?? '担当者が来るまでお待ちください。';
            try {
                const channel = await interaction.guild.channels.create({
                    name: `🎫｜${interaction.user.username}`,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                        { id: adminId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                    ]
                });
                const btn = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('t_close_req').setLabel('チケットを閉じる').setStyle(ButtonStyle.Danger)
                );
                await channel.send({ content: `${interaction.user} 様\n${desc}\n\n<@&${adminId}>`, components: [btn] });
                return await interaction.reply({ content: `チケットを作成しました: ${channel}`, flags: MessageFlags.Ephemeral });
            } catch (e) {
                return await interaction.reply({ content: "❌ チャンネル作成権限がありません。", flags: MessageFlags.Ephemeral });
            }
        }

        if (cid === 't_close_req') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('t_close_yes').setLabel('削除する').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('t_close_no').setLabel('キャンセル').setStyle(ButtonStyle.Secondary)
            );
            return await interaction.reply({ content: 'このチャンネルを削除しますか？', components: [row], flags: MessageFlags.Ephemeral });
        }

        if (cid === 't_close_yes') {
            await interaction.channel.delete().catch(() => {});
        }
        if (cid === 't_close_no') {
            return await interaction.update({ content: '削除をキャンセルしました。', components: [] }).catch(console.error);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
