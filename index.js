const { 
    Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelType, PermissionsBitField, StringSelectMenuBuilder, 
    ActivityType 
} = require('discord.js');
const express = require('express');

// --- 1. Botの初期化 ---
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

// チケットパネルごとのメッセージ内容を保持
const ticketMessages = new Map();

// 【設定】自己紹介ステータスのループ文章（内容は一切変更していません）
const activities = [
    "JYRAC公式Instaはこちら！▶https://www.instagram.com/jyrac_official/",
    "NSF公式Instaはこちら！▶https://www.instagram.com/2024nsfproject/",
    "ボットに関するお知らせはDiscordID’pitayakun7’まで"
];
const intervalSeconds = 15;

// --- 2. スラッシュコマンドの定義（グローバル & ユーザーインストール対応） ---
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
].map(c => {
    const json = c.toJSON();
    json.integration_types = [0, 1]; 
    json.contexts = [0, 1, 2];       
    return json;
});

// --- 3. 起動時処理 & コマンド登録 ---
client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log(`${client.user.tag} 起動完了！`);
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

// --- 4. メインロジック ---
client.on('interactionCreate', async interaction => {
    if (interaction.replied || interaction.deferred) return;

    // A. ロール順位による権限チェック
    if (interaction.guild && (interaction.isChatInputCommand() || (interaction.isButton() && (interaction.customId.startsWith('bulk_delete_yes') || interaction.customId === 't_yes')))) {
        const botMember = interaction.guild.members.me;
        const executor = interaction.member;
        
        if (executor.id !== interaction.guild.ownerId && executor.roles.highest.position <= botMember.roles.highest.position) {
            return await interaction.reply({ content: "お持ちのロールに使用権限がありません", ephemeral: true });
        }
    }

    // B. スラッシュコマンド応答
    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;

        if (commandName === 'help') {
            const embed = new EmbedBuilder().setTitle('📜 コマンドヘルプ').setDescription('詳細を確認したいコマンドを選択してください。').setColor(0x00AE86);
            const select = new StringSelectMenuBuilder().setCustomId('help_select').setPlaceholder('選択...')
                .addOptions(
                    { label: '/verify', value: 'help_verify' },
                    { label: '/ticket', value: 'help_ticket' },
                    { label: '/role-confirmation', value: 'help_role' },
                    { label: '/delete', value: 'help_delete' }
                );
            await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
        }

        if (commandName === 'delete') {
            const amount = options.getInteger('amount');
            if (amount < 1 || amount > 100) return await interaction.reply({ content: '1〜100の間で指定してください。', ephemeral: true });

            const messages = await interaction.channel.messages.fetch({ limit: 1 });
            const lastMsg = messages.first();
            let msgDetails = "確認不可。";
            if (lastMsg) {
                const link = `https://discord.com/channels/${interaction.guildId}/${interaction.channelId}/${lastMsg.id}`;
                msgDetails = `**発言者:** ${lastMsg.author.tag}\n**内容:** ${lastMsg.content.substring(0, 50) || "（画像等）"}\n**リンク:** [移動](${link})`;
            }
            const embed = new EmbedBuilder().setTitle('⚠️ 削除確認').setDescription(`本当に **${amount}件** 削除しますか？\n\n${msgDetails}`).setColor(0xFF0000);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`bulk_delete_yes_${amount}`).setLabel('削除実行').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('bulk_delete_no').setLabel('キャンセル').setStyle(ButtonStyle.Secondary)
            );
            await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
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
            const embed = new EmbedBuilder().setTitle(options.getString('title') ?? 'お問い合わせ').setDescription(options.getString('description') ?? 'ボタンで作成。').setColor(0x9B59B6);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`tkt_${adminRole.id}_${messageKey}`).setLabel('🎫 発行').setStyle(ButtonStyle.Primary));
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'role-confirmation') {
            const target = options.getUser('target');
            const member = await interaction.guild.members.fetch(target.id).catch(() => null);
            if (!member) return await interaction.reply({ content: '取得失敗', ephemeral: true });
            const roles = member.roles.cache.filter(r => r.name !== '@everyone').sort((a,b) => b.position - a.position).map(r => r.name).join('\n') || 'なし';
            await interaction.reply({ content: `**${member.user.tag}** のロール:\n\`\`\`\n${roles}\n\`\`\``, ephemeral: true });
        }
    }

    // C. ヘルプ詳細
    if (interaction.isStringSelectMenu() && interaction.customId === 'help_select') {
        const h = {
            help_verify: "# /verify\n認証パネル作成。ボタンで指定ロール付与。",
            help_ticket: "# /ticket\nチケットパネル作成。管理者用個別チャンネル生成。",
            help_role: "# /role-confirmation\nロールを順位順に表示。",
            help_delete: "# /delete\n一括削除。最新メッセージのリンク確認付。"
        };
        await interaction.update({ content: h[interaction.values[0]], embeds: [], components: [interaction.message.components[0]] });
    }

    // D. ボタン応答
    if (interaction.isButton()) {
        // deleteコマンドの実行
        if (interaction.customId.startsWith('bulk_delete_yes_')) {
            const amount = parseInt(interaction.customId.split('_')[3]);
            await interaction.channel.bulkDelete(amount, true)
                .then(m => interaction.update({ content: `✅ ${m.size}件削除しました。`, embeds: [], components: [] }))
                .catch(() => interaction.update({ content: "❌ 14日以上前のは削除不可。", embeds: [], components: [] }));
        }
        if (interaction.customId === 'bulk_delete_no') await interaction.update({ content: 'キャンセル。', components: [] });

        // ロール付与
        if (interaction.customId.startsWith('v_role_')) {
            const roleId = interaction.customId.split('_')[2];
            await interaction.member.roles.add(roleId).catch(() => {});
            await interaction.reply({ content: '付与完了！', ephemeral: true });
        }

        // チケット作成
        if (interaction.customId.startsWith('tkt_')) {
            const [_, adminId, key] = interaction.customId.split('_');
            const desc = ticketMessages.get(key) ?? 'お待ちください。';
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
            await interaction.reply({ content: `チケット作成: ${channel}`, ephemeral: true });
        }

        // ★修正箇所：チケット削除の二段階確認ボタン
        if (interaction.customId === 't_close_c') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('t_yes').setLabel('削除する').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('t_no').setLabel('キャンセル').setStyle(ButtonStyle.Secondary)
            );
            await interaction.reply({ content: '削除しますか？', components: [row], ephemeral: true });
        }

        // ★修正箇所：削除実行の判定を「t_yes」に統一
        if (interaction.customId === 't_yes') {
            await interaction.channel.delete().catch(() => {});
        }
        if (interaction.customId === 't_no') {
            await interaction.update({ content: '中断。', components: [] });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
